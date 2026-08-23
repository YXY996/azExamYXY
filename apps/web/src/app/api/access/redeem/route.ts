import { redeemAccessKey } from "@/lib/auth-store";
import { authenticatedResponse } from "@/lib/auth-response";
import { authErrorResponse, requireRequestUser } from "@/lib/auth-request";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request), body = await request.json() as { key?: string };
    if (typeof body.key !== "string") return Response.json({ error: "请输入访问 Key" }, { status: 400 });
    return authenticatedResponse(redeemAccessKey(user.id, body.key));
  } catch (error) { return authErrorResponse(error) ?? Response.json({ error: error instanceof Error ? error.message : "兑换失败" }, { status: 400 }); }
}
