import { saveDraft, StoreError } from "@/lib/review-store";
import { parseEditableReview } from "@/lib/review-domain";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function PUT(request: Request, context: RouteContext<"/api/review/questions/[questionId]/draft">) {
  try {
    await requireAdmin(request);
    const { questionId } = await context.params;
    const body = await request.json() as { editable?: unknown; expected_lock_version?: number };
    const editable = parseEditableReview(body.editable);
    if (!editable || !Number.isInteger(body.expected_lock_version)) {
      return Response.json({ error: "Invalid review draft" }, { status: 400 });
    }
    return Response.json(saveDraft(questionId, editable, body.expected_lock_version!));
  } catch (error) {
    const authResponse = authErrorResponse(error); if (authResponse) return authResponse;
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to save review draft" }, { status: 500 });
  }
}
