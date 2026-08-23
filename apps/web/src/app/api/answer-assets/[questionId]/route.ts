import { readFile } from "node:fs/promises";
import path from "node:path";
import { authErrorResponse, requireRequestUser } from "@/lib/auth-request";
import { canAccessQuestion } from "@/lib/review-store";

export const runtime = "nodejs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request, context: { params: Promise<{ questionId: string }> }) {
  const { questionId } = await context.params;
  if (!UUID.test(questionId)) return new Response("Not found", { status: 404 });
  let user;
  try { user = await requireRequestUser(request); }
  catch (error) { return authErrorResponse(error) ?? new Response("Unauthorized", { status: 401 }); }
  if (!canAccessQuestion(user.id, user.role === "admin" || user.access_tier === "full", questionId)) {
    return new Response("Not found", { status: 404 });
  }
  const filename = path.join(process.cwd(), "data", "private", "answer-assets", `${questionId}.png`);
  try {
    const bytes = await readFile(filename);
    if (bytes.length < 8 || bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
      return new Response("Invalid asset", { status: 500 });
    }
    return new Response(bytes, { headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return new Response(code === "ENOENT" ? "Not found" : "Unable to read asset", { status: code === "ENOENT" ? 404 : 500 });
  }
}
