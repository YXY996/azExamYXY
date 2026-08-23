import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken } from "@/lib/session-token";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (pathname === "/api/health" || pathname.startsWith("/api/auth/") || pathname === "/login" || pathname === "/register") return NextResponse.next();
  const secret = process.env.APP_SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "local-development-secret-change-before-deploy");
  if (await verifySessionToken(request.cookies.get("az_exam_session")?.value, secret)) return NextResponse.next();
  if (pathname.startsWith("/api/")) return Response.json({ error: "Authentication required" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
