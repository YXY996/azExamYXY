import { registrationAvailable } from "@/lib/auth-store";
export const runtime = "nodejs";
export async function GET() {
  return Response.json({ registration_available: registrationAvailable() }, { headers: { "Cache-Control": "no-store" } });
}
