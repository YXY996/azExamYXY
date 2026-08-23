import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, stat, unlink } from "node:fs/promises";
import path from "node:path";

import { hasPdfMagic, MAX_UPLOAD_BYTES, parseImportOptions, sanitizeDisplayFilename } from "@/lib/import-domain";
import { ensureImportRunner } from "@/lib/import-runner";
import { createImportJob, listImportJobs, StoreError } from "@/lib/review-store";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try { await requireAdmin(request); } catch (error) { return authErrorResponse(error)!; }
  const jobs = listImportJobs();
  for (const job of jobs) {
    if (["queued", "validating", "extracting", "rendering", "committing"].includes(job.status)) {
      ensureImportRunner(job.job_id);
    }
  }
  return Response.json({ jobs }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const partRoot = path.join(process.cwd(), "data", "private", "uploads", ".incoming");
  await mkdir(partRoot, { recursive: true });
  const partPath = path.join(partRoot, `${randomUUID()}.part`);
  let handle: Awaited<ReturnType<typeof open>> | null = null;
  try {
    await requireAdmin(request);
    const options = parseImportOptions(request.url);
    if (!options) return Response.json({ error: "请选择有效的考试类型和导入范围" }, { status: 400 });
    const { examCode, maxQuestions } = options;
    if (request.headers.get("content-type")?.split(";")[0] !== "application/pdf") {
      return Response.json({ error: "请求内容必须是 PDF" }, { status: 415 });
    }
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (declaredLength > MAX_UPLOAD_BYTES) return Response.json({ error: "PDF 不能超过 100 MiB" }, { status: 413 });
    if (!request.body) return Response.json({ error: "没有收到 PDF 内容" }, { status: 400 });

    handle = await open(partPath, "wx");
    const reader = request.body.getReader();
    const hash = createHash("sha256");
    let total = 0;
    let header = Buffer.alloc(0);
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel();
        throw new StoreError("PDF 不能超过 100 MiB", 413);
      }
      hash.update(value);
      if (header.length < 1024) header = Buffer.concat([header, Buffer.from(value).subarray(0, 1024 - header.length)]);
      await handle.write(value);
    }
    if (total < 5 || !hasPdfMagic(header)) throw new StoreError("文件不是有效的 PDF", 422);
    await handle.sync();
    await handle.close();
    handle = null;

    const sha256 = hash.digest("hex");
    const blobRoot = path.join(process.cwd(), "data", "private", "blobs", sha256.slice(0, 2));
    const blobPath = path.join(blobRoot, `${sha256}.pdf`);
    await mkdir(blobRoot, { recursive: true });
    try {
      await stat(blobPath);
      await unlink(partPath);
    } catch {
      try { await rename(partPath, blobPath); }
      catch {
        await stat(blobPath);
        await unlink(partPath).catch(() => undefined);
      }
    }

    const created = createImportJob({
      id: randomUUID(), sha256, filename: sanitizeDisplayFilename(request.headers.get("x-file-name")),
      examCode, maxQuestions, sourcePath: blobPath,
    });
    ensureImportRunner(created.job.job_id);
    return Response.json({ ...created.job, duplicate: created.duplicate }, {
      status: created.duplicate ? 200 : 202,
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) {
    if (handle) await handle.close().catch(() => undefined);
    await unlink(partPath).catch(() => undefined);
    const authResponse = authErrorResponse(error); if (authResponse) return authResponse;
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "无法保存上传文件" }, { status: 500 });
  }
}
