import { parseEditableReview } from "@/lib/review-domain";
import { approveDraft, StoreError } from "@/lib/review-store";

export const runtime = "nodejs";

export async function POST(request: Request, context: RouteContext<"/api/review/questions/[questionId]/approve">) {
  try {
    const { questionId } = await context.params;
    const body = await request.json() as { editable?: unknown; expected_lock_version?: number };
    const editable = parseEditableReview(body.editable);
    if (!editable || !Number.isInteger(body.expected_lock_version)) {
      return Response.json({ error: "Invalid approval request" }, { status: 400 });
    }
    return Response.json(approveDraft(questionId, editable, body.expected_lock_version!));
  } catch (error) {
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to approve question" }, { status: 500 });
  }
}
