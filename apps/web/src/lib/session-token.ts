const encoder = new TextEncoder();

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value))));
}

export async function createSessionToken(userId: string, secret: string) {
  const payload = base64url(encoder.encode(JSON.stringify({ sub: userId, exp: Date.now() + 30 * 24 * 60 * 60 * 1000 })));
  return `${payload}.${await sign(payload, secret)}`;
}

export async function verifySessionToken(token: string | undefined, secret: string) {
  return Boolean(await readSessionToken(token, secret));
}

export async function readSessionToken(token: string | undefined, secret: string) {
  if (!token || !secret) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || signature !== await sign(payload, secret)) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as { sub?: string; exp?: number };
    return typeof parsed.sub === "string" && typeof parsed.exp === "number" && parsed.exp > Date.now()
      ? { sub: parsed.sub, exp: parsed.exp }
      : null;
  } catch {
    return null;
  }
}
