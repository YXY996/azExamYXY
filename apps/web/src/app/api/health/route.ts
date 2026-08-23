import { getHealthStatus } from "@/lib/review-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(getHealthStatus(), {
      headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch {
    return Response.json({ status: "unhealthy", database: "error" }, {
      status: 503, headers: { "Cache-Control": "no-store" },
    });
  }
}
