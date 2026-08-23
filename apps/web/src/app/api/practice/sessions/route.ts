import { startOrResumePractice, StoreError } from "@/lib/review-store";
import { authErrorResponse, requireRequestUser } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const fullAccess = user.role === "admin" || user.access_tier === "full";
    const body = await request.json().catch(() => ({})) as { exam_code?: string; fresh?: boolean; mode?: string; knowledge_points?: unknown };
    const examCode = body.exam_code ?? "AZ-104";
    if (!['AZ-104', 'AZ-305'].includes(examCode)) {
      return Response.json({ error: "Invalid exam code" }, { status: 400 });
    }
    const mode = body.mode === "wrong_book" ? "wrong_book" : "random";
    if (body.knowledge_points !== undefined && (!Array.isArray(body.knowledge_points) || body.knowledge_points.some((point) => typeof point !== "string"))) {
      return Response.json({ error: "Invalid knowledge points" }, { status: 400 });
    }
    return Response.json(startOrResumePractice(user.id, fullAccess, examCode, body.fresh === true, mode, body.knowledge_points as string[] | undefined));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to start practice" }, { status: 500 });
  }
}
