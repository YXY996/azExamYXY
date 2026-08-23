import { startOrResumePractice, StoreError } from "@/lib/review-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({})) as { exam_code?: string; fresh?: boolean; mode?: string };
    const examCode = body.exam_code ?? "AZ-104";
    if (!['AZ-104', 'AZ-305'].includes(examCode)) {
      return Response.json({ error: "Invalid exam code" }, { status: 400 });
    }
    const mode = body.mode === "wrong_book" ? "wrong_book" : "random";
    return Response.json(startOrResumePractice(examCode, body.fresh === true, mode));
  } catch (error) {
    if (error instanceof StoreError) return Response.json({ error: error.message }, { status: error.status });
    return Response.json({ error: "Unable to start practice" }, { status: 500 });
  }
}
