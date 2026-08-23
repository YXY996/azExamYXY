import { buildAgentMonitorSnapshot } from "@/lib/agent-monitor";

export const runtime = "nodejs";

export async function GET() {
  return Response.json(await buildAgentMonitorSnapshot(), {
    headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
  });
}
