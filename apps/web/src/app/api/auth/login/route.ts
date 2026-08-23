import { authenticatedResponse } from "@/lib/auth-response";
import { authenticateUser } from "@/lib/auth-store";
import { clearLoginFailures, loginBlockSeconds, loginClientKey, recordLoginFailure } from "@/lib/login-rate-limit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const clientKey = loginClientKey(request);
  const blockedFor = loginBlockSeconds(clientKey);
  if (blockedFor > 0) {
    return Response.json({ error: "登录尝试过多，请稍后再试" }, { status: 429, headers: { "Retry-After": String(blockedFor) } });
  }
  try {
    const body = await request.json() as { username?: string; password?: string };
    if (typeof body.username !== "string" || typeof body.password !== "string") {
      return Response.json({ error: "请输入用户名和密码" }, { status: 400 });
    }
    const user = authenticateUser(body.username.trim(), body.password);
    if (user) {
      clearLoginFailures(clientKey);
      return authenticatedResponse(user);
    }
    recordLoginFailure(clientKey);
    return Response.json({ error: "用户名或密码不正确" }, { status: 401 });
  } catch {
    return Response.json({ error: "登录暂时不可用" }, { status: 500 });
  }
}
