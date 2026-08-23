import { readFile } from "node:fs/promises";
import path from "node:path";

import { documentExists } from "@/lib/review-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: RouteContext<"/api/documents/[documentId]/pages/[page]">) {
  const { documentId, page } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(documentId) || !/^\d{1,4}$/.test(page)) {
    return Response.json({ error: "Invalid document or page" }, { status: 400 });
  }
  const pageNumber = Number(page);
  if (pageNumber < 1 || pageNumber > 2000) return Response.json({ error: "Page out of range" }, { status: 400 });
  if (!documentExists(documentId)) return Response.json({ error: "Page not found" }, { status: 404 });
  const imagePath = path.join(process.cwd(), "data", "private", "documents", documentId, "pages", `page-${String(pageNumber).padStart(4, "0")}.png`);
  try {
    return new Response(await readFile(imagePath), {
      headers: {
        "Content-Type": "image/png", "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "Page not found" }, { status: 404 });
    return Response.json({ error: "Unable to read source page" }, { status: 500 });
  }
}
