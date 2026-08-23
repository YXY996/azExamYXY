import { describe, expect, it } from "vitest";

import { hasPdfMagic, parseImportOptions, sanitizeDisplayFilename } from "./import-domain";

describe("PDF upload boundary", () => {
  it("removes path components and Windows-reserved characters from display names", () => {
    expect(sanitizeDisplayFilename("..%2F..%2FC%3A%5Csecret%3F.pdf")).toBe("secret_.pdf");
  });

  it("recognizes PDF magic without trusting the extension", () => {
    expect(hasPdfMagic(Buffer.from("noise%PDF-1.7"))).toBe(true);
    expect(hasPdfMagic(Buffer.from("not a pdf"))).toBe(false);
  });

  it("accepts only supported import configurations", () => {
    expect(parseImportOptions("http://local/api/imports?exam_code=AZ-104&max_questions=50")).toEqual({ examCode: "AZ-104", maxQuestions: 50 });
    expect(parseImportOptions("http://local/api/imports?exam_code=AZ-999&max_questions=5000")).toBeNull();
  });
});
