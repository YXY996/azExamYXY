import { setWrongBookMark, StoreError } from "@/lib/review-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/practice/sessions/[sessionId]/mark">) {
  try {
    const { sessionId } = await context.params;
    const body = await request.json() as { item_id?: string; marked?: boolean };
    if (!body.item_id || typeof body.marked !== "boolean") {
      return Response.json({ error: "Invalid mark request" }, { status: 400 });
    }
    return Response.json(setWrongBookMark(sessionId, body.item_id, body.marked));
  } catch (error) {
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to update wrong book" }, { status: 500 });
  }
}
