import { NextResponse } from "next/server";
import type { AppUser } from "./auth-store";
import { createSessionToken } from "./session-token";

export function sessionSecret() {
  const secret = process.env.APP_SESSION_SECRET ?? (process.env.NODE_ENV === "production" ? "" : "local-development-secret-change-before-deploy");
  if (secret.length < 32) throw new Error("APP_SESSION_SECRET must contain at least 32 characters");
  return secret;
}

export async function authenticatedResponse(user: AppUser) {
  const response = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role, access_tier: user.access_tier } });
  response.cookies.set("az_exam_session", await createSessionToken(user.id, sessionSecret()), {
    httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production",
    path: "/", maxAge: 30 * 24 * 60 * 60,
  });
  return response;
}
