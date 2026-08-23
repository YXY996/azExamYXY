export type AnswerProvenance = {
  kind: "manual" | "source_document" | "external_reference";
  reference: string;
  confirmed_at: string;
  confirmed_by: string;
};

export type Option = {
  id: string;
  label: string;
  raw: string;
  display: string;
  confidence: number;
  reviewed: boolean;
};

export type CandidateQuestion = {
  schema_version: string;
  question_id: string;
  bank_id: string;
  exam_code: "AZ-104" | "AZ-305";
  source_document_id: string;
  source_question_no: string;
  type: "single_choice" | "multiple_choice" | "true_false" | "image_interaction" | "unknown";
  status: "draft" | "needs_review" | "approved";
  stem: { raw: string; display: string; confidence: number; reviewed: boolean };
  options: Option[];
  correct_option_ids: string[];
  answer_confidence: number;
  answer_provenance: AnswerProvenance | null;
  explanation: null | { raw: string; display: string; confidence: number; reviewed: boolean; answer_image_url?: string };
  source_spans: Array<{ page: number; bbox: number[]; extractor: string; text: string; confidence: number }>;
  quality: { overall_confidence: number; flags: string[] };
  content_version: number;
  topic: number;
  knowledge_points?: string[];
  difficulty?: "easy" | "medium" | "hard";
  source_pages: number[];
};

export type CandidateBundle = {
  document: {
    document_id?: string;
    sha256?: string;
    filename: string;
    exam_code: string;
    page_count: number;
    status: string;
  };
  candidates: CandidateQuestion[];
  review_versions: Record<string, number>;
};

export type PracticeItem = {
  item_id: string;
  ordinal: number;
  question_revision_id: string;
  question: Pick<CandidateQuestion, "question_id" | "source_document_id" | "source_question_no" | "source_pages" | "type" | "stem" | "options" | "explanation" | "topic" | "exam_code" | "knowledge_points" | "difficulty">;
  result: null | { is_correct: boolean; selected_option_ids: string[]; correct_option_ids: string[] };
  is_marked: boolean;
};

export type PracticeSession = {
  session_id: string;
  status: "active" | "completed";
  started_at: string;
  completed_at: string | null;
  mode: "random" | "wrong_book";
  exam_code: "AZ-104" | "AZ-305";
  knowledge_points: string[];
  items: PracticeItem[];
  summary: { answered: number; correct: number; total: number; accuracy: number; duration_ms: number };
};

export type ImportJob = {
  job_id: string;
  filename: string;
  exam_code: "AZ-104" | "AZ-305";
  status: "queued" | "validating" | "extracting" | "rendering" | "committing" | "review_ready" | "failed";
  stage: string;
  progress_current: number | null;
  progress_total: number | null;
  candidate_count: number | null;
  page_count: number | null;
  error_summary: string | null;
  created_at: string;
  updated_at: string;
};

export type StudySummary = {
  active_session: null | { session_id: string; answered: number; correct: number; total: number; accuracy: number; duration_ms: number; started_at: string };
  wrong_question_count: number;
  recent_sessions: Array<{
    session_id: string;
    status: "active" | "completed";
    answered: number;
    correct: number;
    total: number;
    accuracy: number;
    duration_ms: number;
    mode: "random" | "wrong_book";
    started_at: string;
    completed_at: string | null;
  }>;
};

export type PracticeFilters = {
  exams: Array<{
    exam_code: "AZ-104" | "AZ-305";
    total: number;
    knowledge_points: Array<{ name: string; count: number }>;
  }>;
};
