import { getPracticeFilters } from "@/lib/review-store";
import { authErrorResponse, requireRequestUser } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    return Response.json(getPracticeFilters(user.id, user.role === "admin" || user.access_tier === "full"));
  } catch (error) {
    return authErrorResponse(error) ?? Response.json({ error: "Unable to load practice filters" }, { status: 500 });
  }
}
