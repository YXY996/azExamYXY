import { getPracticeFilters } from "@/lib/review-store";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(getPracticeFilters());
}
