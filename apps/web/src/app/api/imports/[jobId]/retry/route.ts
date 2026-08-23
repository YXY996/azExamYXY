import { ensureImportRunner } from "@/lib/import-runner";
import { retryImportJob, StoreError } from "@/lib/review-store";

export const runtime = "nodejs";

export async function POST(_request: Request, context: RouteContext<"/api/imports/[jobId]/retry">) {
  try {
    const { jobId } = await context.params;
    const job = retryImportJob(jobId);
    ensureImportRunner(jobId);
    return Response.json(job);
  } catch (error) {
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "无法重试导入任务" }, { status: 500 });
  }
}
