import { listUsers } from "@/lib/auth-store";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { await requireAdmin(request); return Response.json({ users: listUsers() }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return authErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "读取用户失败" }, { status: 400 }); }
}
