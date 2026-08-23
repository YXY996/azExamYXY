import { getUserById, type AppUser } from "./auth-store";
import { sessionSecret } from "./auth-response";
import { readSessionToken } from "./session-token";

export class AuthError extends Error {
  constructor(public readonly status: 401 | 403, message: string) { super(message); this.name = "AuthError"; }
}

function cookieValue(request: Request, name: string) {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
}

export async function getRequestUser(request: Request): Promise<AppUser | null> {
  const session = await readSessionToken(cookieValue(request, "az_exam_session"), sessionSecret());
  return session ? getUserById(session.sub) : null;
}

export async function requireRequestUser(request: Request): Promise<AppUser> {
  const user = await getRequestUser(request);
  if (!user) throw new AuthError(401, "请先登录");
  return user;
}

export async function requireAdmin(request: Request): Promise<AppUser> {
  const user = await requireRequestUser(request);
  if (user.role !== "admin") throw new AuthError(403, "需要管理员权限");
  return user;
}

export function authErrorResponse(error: unknown) {
  return error instanceof AuthError ? Response.json({ error: error.message }, { status: error.status }) : null;
}
