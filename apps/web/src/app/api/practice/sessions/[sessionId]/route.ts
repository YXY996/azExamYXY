import { getPracticeSession, StoreError } from "@/lib/review-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/practice/sessions/[sessionId]">) {
  try {
    const { sessionId } = await context.params;
    return Response.json(getPracticeSession(sessionId));
  } catch (error) {
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to load practice" }, { status: 500 });
  }
}
