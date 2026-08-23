import { randomUUID } from "node:crypto";

import { StoreError, submitPracticeAnswer } from "@/lib/review-store";
import { authErrorResponse, requireRequestUser } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/practice/sessions/[sessionId]/answers">) {
  try {
    const user = await requireRequestUser(request);
    const { sessionId } = await context.params;
    const body = await request.json() as { event_id?: string; item_id?: string; selected_option_ids?: string[]; duration_ms?: number };
    if (!body.item_id || !Array.isArray(body.selected_option_ids)) {
      return Response.json({ error: "Invalid answer event" }, { status: 400 });
    }
    return Response.json(submitPracticeAnswer(
      user.id, user.role === "admin" || user.access_tier === "full",
      sessionId, body.item_id, body.event_id ?? randomUUID(), body.selected_option_ids,
      typeof body.duration_ms === "number" ? body.duration_ms : 0,
    ));
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to submit answer" }, { status: 500 });
  }
}
