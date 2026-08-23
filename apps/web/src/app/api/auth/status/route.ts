import { registrationAvailable } from "@/lib/auth-store";
import { getRequestUser } from "@/lib/auth-request";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const user = await getRequestUser(request);
  return Response.json({ registration_available: registrationAvailable(), user }, { headers: { "Cache-Control": "no-store" } });
}
