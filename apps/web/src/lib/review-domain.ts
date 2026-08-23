import type { AnswerProvenance, CandidateQuestion } from "./types";

export type EditableReview = Pick<
  CandidateQuestion,
  "type" | "stem" | "options" | "correct_option_ids" | "answer_confidence" | "answer_provenance" | "explanation"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseEditableReview(value: unknown): EditableReview | null {
  if (!isRecord(value) || !["single_choice", "multiple_choice", "true_false", "image_interaction", "unknown"].includes(String(value.type))) return null;
  if (!isRecord(value.stem) || typeof value.stem.raw !== "string" || typeof value.stem.display !== "string"
    || typeof value.stem.confidence !== "number" || typeof value.stem.reviewed !== "boolean") return null;
  if (!Array.isArray(value.options) || !Array.isArray(value.correct_option_ids)
    || value.correct_option_ids.some((id) => typeof id !== "string")) return null;
  const optionsValid = value.options.every((option) => isRecord(option)
    && typeof option.id === "string" && typeof option.label === "string"
    && typeof option.raw === "string" && typeof option.display === "string"
    && typeof option.confidence === "number" && typeof option.reviewed === "boolean");
  if (!optionsValid || typeof value.answer_confidence !== "number") return null;
  if (value.answer_provenance !== null) {
    if (!isRecord(value.answer_provenance)
      || !["manual", "source_document", "external_reference"].includes(String(value.answer_provenance.kind))
      || typeof value.answer_provenance.reference !== "string"
      || typeof value.answer_provenance.confirmed_at !== "string"
      || typeof value.answer_provenance.confirmed_by !== "string") return null;
  }
  if (value.explanation !== null) {
    if (!isRecord(value.explanation)
      || typeof value.explanation.raw !== "string"
      || typeof value.explanation.display !== "string"
      || typeof value.explanation.confidence !== "number"
      || typeof value.explanation.reviewed !== "boolean"
      || (value.explanation.answer_image_url !== undefined && typeof value.explanation.answer_image_url !== "string")) return null;
  }
  return value as EditableReview;
}

const blockingFlags = new Set(["unsupported_or_image_question", "options_missing"]);

export function applyEditableReview(base: CandidateQuestion, editable: EditableReview): CandidateQuestion {
  return {
    ...base,
    ...editable,
    status: "needs_review",
    stem: { ...editable.stem },
    options: editable.options.map((option) => ({ ...option })),
    correct_option_ids: [...editable.correct_option_ids],
    answer_provenance: editable.answer_provenance ? { ...editable.answer_provenance } : null,
    explanation: editable.explanation ? { ...editable.explanation } : null,
  };
}

export function validatePublishable(question: CandidateQuestion): string[] {
  const errors: string[] = [];
  if (question.type === "unknown") errors.push("题型仍为未知或图片交互题");
  if (question.type === "image_interaction" && !question.explanation?.answer_image_url?.startsWith("/api/answer-assets/")) {
    errors.push("图片交互题缺少私有答案图");
  }
  if (!question.stem.display.trim()) errors.push("题干不能为空");
  if (question.options.length < 2) errors.push("至少需要两个选项");

  const ids = new Set<string>();
  const labels = new Set<string>();
  for (const option of question.options) {
    if (!option.display.trim()) errors.push("选项内容不能为空");
    if (!option.label.trim()) errors.push("选项标签不能为空");
    if (ids.has(option.id)) errors.push("选项 ID 不能重复");
    if (labels.has(option.label.trim().toUpperCase())) errors.push("选项标签不能重复");
    ids.add(option.id);
    labels.add(option.label.trim().toUpperCase());
  }
  if (question.correct_option_ids.some((id) => !ids.has(id))) errors.push("正确答案必须引用现有选项");
  if (new Set(question.correct_option_ids).size !== question.correct_option_ids.length) errors.push("正确答案不能重复");
  if (["single_choice", "true_false"].includes(question.type) && question.correct_option_ids.length !== 1) {
    errors.push("单选或判断题必须有且仅有一个正确答案");
  }
  if (question.type === "multiple_choice" && question.correct_option_ids.length < 2) {
    errors.push("多选题至少需要两个正确答案");
  }
  if (!question.answer_provenance || question.answer_provenance.reference.trim().length < 3) {
    errors.push("必须填写可追溯的答案来源");
  }
  if (!question.explanation?.display.trim()) errors.push("必须填写答案解析");
  if (question.type !== "image_interaction" && question.quality.flags.some((flag) => blockingFlags.has(flag))) {
    errors.push("仍有阻塞型质量问题未处理");
  }
  return [...new Set(errors)];
}

export function makeManualProvenance(reference: string): AnswerProvenance {
  return {
    kind: "manual",
    reference: reference.trim(),
    confirmed_at: new Date().toISOString(),
    confirmed_by: "local-owner",
  };
}
