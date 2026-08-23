import { ensureImportRunner } from "@/lib/import-runner";
import { retryImportJob, StoreError } from "@/lib/review-store";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/imports/[jobId]/retry">) {
  try {
    await requireAdmin(request);
    const { jobId } = await context.params;
    const job = retryImportJob(jobId);
    ensureImportRunner(jobId);
    return Response.json(job);
  } catch (error) {
    const authResponse = authErrorResponse(error); if (authResponse) return authResponse;
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "无法重试导入任务" }, { status: 500 });
  }
}
