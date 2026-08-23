export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export function sanitizeDisplayFilename(value: string | null) {
  let decoded = "uploaded.pdf";
  try { decoded = decodeURIComponent(value ?? decoded); } catch {}
  const basename = decoded.split(/[\\/]/).pop() ?? "uploaded.pdf";
  return basename.replace(/[\u0000-\u001f<>:"|?*]/g, "_").slice(0, 180) || "uploaded.pdf";
}

export function hasPdfMagic(header: Uint8Array) {
  return Buffer.from(header).includes(Buffer.from("%PDF-"));
}

export function parseImportOptions(url: string) {
  const parsed = new URL(url);
  const examCode = parsed.searchParams.get("exam_code");
  const maxQuestions = Number(parsed.searchParams.get("max_questions") ?? "50");
  if (examCode !== "AZ-104" && examCode !== "AZ-305") return null;
  if (!Number.isInteger(maxQuestions) || maxQuestions < 1 || maxQuestions > 1000) return null;
  return { examCode, maxQuestions } as const;
}
