import { ensureImportRunner } from "@/lib/import-runner";
import { getImportJob, StoreError } from "@/lib/review-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/imports/[jobId]">) {
  try {
    const { jobId } = await context.params;
    const job = getImportJob(jobId);
    if (["queued", "validating", "extracting", "rendering", "committing"].includes(job.status)) ensureImportRunner(jobId);
    return Response.json(job, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "无法读取导入任务" }, { status: 500 });
  }
}
