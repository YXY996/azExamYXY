import { revokeAccessKey } from "@/lib/auth-store";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const admin = await requireAdmin(request), { id } = await context.params; return Response.json({ user: revokeAccessKey(admin.id, id) }); }
  catch (error) { return authErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "撤销 Key 失败" }, { status: 400 }); }
}
