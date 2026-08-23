import { ensureImportRunner } from "@/lib/import-runner";
import { getImportJob, StoreError } from "@/lib/review-store";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/imports/[jobId]">) {
  try {
    await requireAdmin(request);
    const { jobId } = await context.params;
    const job = getImportJob(jobId);
    if (["queued", "validating", "extracting", "rendering", "committing"].includes(job.status)) ensureImportRunner(jobId);
    return Response.json(job, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const authResponse = authErrorResponse(error); if (authResponse) return authResponse;
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "无法读取导入任务" }, { status: 500 });
  }
}
