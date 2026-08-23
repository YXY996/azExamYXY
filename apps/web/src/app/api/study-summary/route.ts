import { getStudySummary } from "@/lib/review-store";
import { authErrorResponse, requireRequestUser } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    return Response.json(getStudySummary(user.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "Unable to load study summary" }, { status: 500 });
  }
}
