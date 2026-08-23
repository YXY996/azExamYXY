import { authenticatedResponse } from "@/lib/auth-response";
import { registerUser } from "@/lib/auth-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json() as { username?: string; password?: string };
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return Response.json({ error: "请输入用户名和密码" }, { status: 400 });
    }
    return authenticatedResponse(registerUser(body.username.trim(), body.password));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "注册失败" }, { status: 409 });
  }
}
