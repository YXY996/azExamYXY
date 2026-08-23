import { buildAgentMonitorSnapshot } from "@/lib/agent-monitor";
import { authErrorResponse, requireAdmin } from "@/lib/auth-request";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    return Response.json(await buildAgentMonitorSnapshot(), {
      headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
    });
  } catch (error) { return authErrorResponse(error) ?? Response.json({ error: "Unable to read monitor" }, { status: 500 }); }
}
