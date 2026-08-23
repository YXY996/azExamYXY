import { describe, expect, it } from "vitest";

import { applyEditableReview, makeManualProvenance, parseEditableReview, validatePublishable } from "./review-domain";
import type { CandidateQuestion } from "./types";

function question(overrides: Partial<CandidateQuestion> = {}): CandidateQuestion {
  const options = [
    { id: "a", label: "A", raw: "One", display: "One", confidence: 1, reviewed: false },
    { id: "b", label: "B", raw: "Two", display: "Two", confidence: 1, reviewed: false },
  ];
  return {
    schema_version: "1.0", question_id: "q", bank_id: "b", exam_code: "AZ-104",
    source_document_id: "d", source_question_no: "T1-Q1", type: "single_choice",
    status: "needs_review", stem: { raw: "Question", display: "Question", confidence: 1, reviewed: false },
    options, correct_option_ids: ["a"], answer_confidence: 1,
    answer_provenance: makeManualProvenance("Checked against answer sheet page 1"),
    explanation: { raw: "Because option A is correct.", display: "Because option A is correct.", confidence: 1, reviewed: false },
    source_spans: [{ page: 1, bbox: [0, 0, 1, 1], extractor: "pdf_text", text: "", confidence: 1 }],
    quality: { overall_confidence: 1, flags: [] }, content_version: 1, topic: 1, source_pages: [1],
    ...overrides,
  };
}

describe("review publication gate", () => {
  it("accepts a complete traceable single-choice question", () => {
    expect(validatePublishable(question())).toEqual([]);
  });

  it("rejects a correct option that is not part of the question", () => {
    expect(validatePublishable(question({ correct_option_ids: ["missing"] }))).toContain("正确答案必须引用现有选项");
  });

  it("rejects missing provenance and unsupported image questions", () => {
    const errors = validatePublishable(question({
      type: "unknown", answer_provenance: null,
      quality: { overall_confidence: 0, flags: ["unsupported_or_image_question"] },
    }));
    expect(errors).toContain("题型仍为未知或图片交互题");
    expect(errors).toContain("必须填写可追溯的答案来源");
    expect(errors).toContain("仍有阻塞型质量问题未处理");
  });

  it("reopens an approved question when editable fields change", () => {
    const base = question({ status: "approved" });
    const changed = applyEditableReview(base, { ...base, stem: { ...base.stem, display: "Changed" } });
    expect(changed.status).toBe("needs_review");
    expect(changed.stem.display).toBe("Changed");
  });

  it("requires an explanation before publication", () => {
    expect(validatePublishable(question({ explanation: null }))).toContain("必须填写答案解析");
  });

  it("rejects a malformed editable payload before it reaches storage", () => {
    expect(parseEditableReview({ type: "single_choice", options: "not-an-array" })).toBeNull();
  });

  it("accepts a structurally complete editable payload", () => {
    expect(parseEditableReview(question())).not.toBeNull();
  });

  it("publishes a PDF-backed image interaction despite legacy parser flags", () => {
    const imageQuestion = question({
      type: "image_interaction",
      explanation: {
        raw: "Compare with the marked PDF.", display: "请对照 PDF 标记答案自评。",
        confidence: 1, reviewed: false, answer_image_url: "/api/answer-assets/00000000-0000-4000-8000-000000000000",
      },
      quality: { overall_confidence: 0.5, flags: ["unsupported_or_image_question", "options_missing"] },
    });
    expect(validatePublishable(imageQuestion)).toEqual([]);
  });

  it("rejects an image interaction without its private answer asset", () => {
    expect(validatePublishable(question({ type: "image_interaction" }))).toContain("图片交互题缺少私有答案图");
  });
});
