import { getPracticeSession, StoreError } from "@/lib/review-store";
import { authErrorResponse, requireRequestUser } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function GET(request: Request, context: RouteContext<"/api/practice/sessions/[sessionId]">) {
  try {
    const user = await requireRequestUser(request);
    const { sessionId } = await context.params;
    return Response.json(getPracticeSession(user.id, user.role === "admin" || user.access_tier === "full", sessionId));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to load practice" }, { status: 500 });
  }
}
