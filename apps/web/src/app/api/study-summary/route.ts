import { getStudySummary } from "@/lib/review-store";

export const runtime = "nodejs";

export function GET() {
  return Response.json(getStudySummary(), { headers: { "Cache-Control": "private, no-store" } });
}
