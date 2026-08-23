import { createAccessKey, listAccessKeys } from "@/lib/auth-store";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try { const admin = await requireAdmin(request); return Response.json({ keys: listAccessKeys(admin.id) }, { headers: { "Cache-Control": "no-store" } }); }
  catch (error) { return authErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "读取 Key 失败" }, { status: 400 }); }
}
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request), body = await request.json() as { user_id?: string };
    if (typeof body.user_id !== "string") return Response.json({ error: "请选择用户" }, { status: 400 });
    return Response.json({ access_key: createAccessKey(admin.id, body.user_id) }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) { return authErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "创建 Key 失败" }, { status: 400 }); }
}
