from __future__ import annotations

import hashlib
import re
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, TypeAlias

from pypdf import PdfReader


QUESTION_HEADER = re.compile(
    r"Topic\s+(?P<topic>\d+)\s+Question\s+#(?P<number>\d+)",
    re.IGNORECASE,
)
OPTION_LABEL = re.compile(r"^(?P<label>[A-H])[.)]?$", re.IGNORECASE)
MULTIPLE_HINT = re.compile(
    r"\b(?:choose|select)\s+(?:two|three|four|2|3|4)\b|"
    r"\beach correct answer\b|\bwhich two\b|\bwhich three\b",
    re.IGNORECASE,
)
UNSUPPORTED_HINT = re.compile(
    r"\bHOTSPOT\b|\bHot Area\b|\bdrag and drop\b|\bselect the appropriate options in the answer area\b",
    re.IGNORECASE,
)

NOISE_LINES = {
    "-",
    ".",
    "Free",
    "Expert Verified, Online,",
    "Exam AZ-104",
}


@dataclass
class ParsedQuestion:
    topic: int
    number: int
    pages: list[int]
    raw_parts: list[str] = field(default_factory=list)
    empty_pages: list[int] = field(default_factory=list)

    @property
    def raw_text(self) -> str:
        return "\n".join(part for part in self.raw_parts if part).strip()


def _clean_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw_line in text.replace("\x00", "").splitlines():
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or line in NOISE_LINES:
            continue
        if re.fullmatch(r"All Actual Questions\(\d{4}/\d{2}/\d{2}\)", line):
            continue
        if re.fullmatch(r"Topic \d+", line, re.IGNORECASE):
            continue
        if re.fullmatch(r"Question #\d+", line, re.IGNORECASE):
            continue
        if "题库来源" in line or "est258258" in line:
            continue
        lines.append(line)
    return lines


def _question_body(text: str, header: re.Match[str] | None) -> str:
    body = text[header.end() :] if header else text
    return "\n".join(_clean_lines(body))


PageInput: TypeAlias = tuple[int, str] | tuple[int, str, bool]


def parse_question_pages(
    pages: Iterable[PageInput], max_questions: int | None = None
) -> list[ParsedQuestion]:
    questions: list[ParsedQuestion] = []
    current: ParsedQuestion | None = None

    for page_input in pages:
        page_number, page_text = page_input[:2]
        has_images = page_input[2] if len(page_input) == 3 else False
        normalized = page_text.replace("\x00", "")
        header = QUESTION_HEADER.search(re.sub(r"\s+", " ", normalized))

        if header:
            if max_questions is not None and len(questions) >= max_questions:
                break
            current = ParsedQuestion(
                topic=int(header.group("topic")),
                number=int(header.group("number")),
                pages=[page_number],
            )
            body = _question_body(normalized, QUESTION_HEADER.search(normalized))
            if body:
                current.raw_parts.append(body)
            else:
                current.empty_pages.append(page_number)
            questions.append(current)
            continue

        if current is not None:
            # PDFs often contain true blank separator pages. Keep image-only pages
            # because they can contain the complete answer area for a question.
            if not normalized.strip() and not has_images:
                continue
            current.pages.append(page_number)
            body = _question_body(normalized, None)
            if body:
                current.raw_parts.append(body)
            else:
                current.empty_pages.append(page_number)

    return questions


def split_stem_and_options(text: str) -> tuple[str, list[tuple[str, str]]]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    option_starts: list[tuple[int, str]] = []
    for index, line in enumerate(lines):
        match = OPTION_LABEL.fullmatch(line)
        if match:
            option_starts.append((index, match.group("label").upper()))

    if len(option_starts) < 2:
        return "\n".join(lines).strip(), []

    first_option_index = option_starts[0][0]
    stem = "\n".join(lines[:first_option_index]).strip()
    options: list[tuple[str, str]] = []
    for option_index, (line_index, label) in enumerate(option_starts):
        end = (
            option_starts[option_index + 1][0]
            if option_index + 1 < len(option_starts)
            else len(lines)
        )
        display = " ".join(lines[line_index + 1 : end]).strip()
        if display:
            options.append((label, display))
    return stem, options


def infer_question_type(stem: str, options: list[tuple[str, str]]) -> str:
    if UNSUPPORTED_HINT.search(stem) or len(options) < 2:
        return "unknown"
    normalized_options = {value.casefold() for _, value in options}
    if normalized_options in ({"yes", "no"}, {"true", "false"}):
        return "true_false"
    if MULTIPLE_HINT.search(stem):
        return "multiple_choice"
    return "single_choice"


def _stable_uuid(namespace: uuid.UUID, value: str) -> str:
    return str(uuid.uuid5(namespace, value))


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def candidate_from_question(
    question: ParsedQuestion,
    *,
    document_id: str,
    bank_id: str,
    exam_code: str,
) -> dict:
    stem, parsed_options = split_stem_and_options(question.raw_text)
    question_key = f"{document_id}:{question.topic}:{question.number}:{question.pages[0]}"
    question_id = _stable_uuid(uuid.NAMESPACE_URL, question_key)
    question_type = infer_question_type(stem, parsed_options)

    flags = ["answer_missing"]
    if question_type == "unknown":
        flags.append("unsupported_or_image_question")
    if len(question.pages) > 1:
        flags.append("cross_page_merge")
    if question.empty_pages:
        flags.append("page_text_empty")
    if len(parsed_options) < 2:
        flags.append("options_missing")

    options = []
    for label, display in parsed_options:
        option_id = _stable_uuid(uuid.NAMESPACE_URL, f"{question_id}:option:{label}")
        options.append(
            {
                "id": option_id,
                "label": label,
                "raw": display,
                "display": display,
                "confidence": 0.98,
                "reviewed": False,
            }
        )

    source_spans = [
        {
            "page": page,
            "bbox": [0.0, 0.0, 1.0, 1.0],
            "extractor": "pdf_text" if page not in question.empty_pages else "manual",
            "text": question.raw_text if page == question.pages[0] else "",
            "confidence": 0.95 if page not in question.empty_pages else 0.0,
        }
        for page in question.pages
    ]

    return {
        "schema_version": "1.0",
        "question_id": question_id,
        "bank_id": bank_id,
        "exam_code": exam_code,
        "source_document_id": document_id,
        "source_question_no": f"T{question.topic}-Q{question.number}",
        "type": question_type,
        "status": "needs_review",
        "stem": {
            "raw": stem,
            "display": stem,
            "confidence": 0.96 if stem else 0.0,
            "reviewed": False,
        },
        "options": options,
        "correct_option_ids": [],
        "answer_confidence": 0.0,
        "answer_provenance": None,
        "explanation": None,
        "assets": [],
        "source_spans": source_spans,
        "quality": {
            "overall_confidence": 0.0,
            "flags": flags,
            "duplicate_group_id": None,
        },
        "content_version": 1,
        "topic": question.topic,
        "source_pages": question.pages,
    }


def import_pdf(
    path: Path, *, exam_code: str = "AZ-104", max_questions: int | None = None
) -> dict:
    if exam_code not in {"AZ-104", "AZ-305"}:
        raise ValueError("exam_code must be AZ-104 or AZ-305")
    file_hash = _file_sha256(path)
    document_id = _stable_uuid(uuid.NAMESPACE_URL, f"document:{file_hash}")
    bank_id = _stable_uuid(uuid.NAMESPACE_URL, f"bank:{exam_code}:{file_hash}")
    reader = PdfReader(str(path))
    if reader.is_encrypted:
        raise ValueError("Encrypted PDFs are not supported")
    if not 1 <= len(reader.pages) <= 2000:
        raise ValueError("PDF page count must be between 1 and 2000")

    def page_stream() -> Iterable[PageInput]:
        for index, page in enumerate(reader.pages, start=1):
            resources = page.get("/Resources") or {}
            xobjects = resources.get("/XObject") if hasattr(resources, "get") else None
            has_images = bool(xobjects)
            yield index, page.extract_text() or "", has_images

    parsed = parse_question_pages(page_stream(), max_questions=max_questions)
    candidates = [
        candidate_from_question(
            item,
            document_id=document_id,
            bank_id=bank_id,
            exam_code=exam_code,
        )
        for item in parsed
    ]
    return {
        "document": {
            "document_id": document_id,
            "filename": path.name,
            "sha256": file_hash,
            "exam_code": exam_code,
            "page_count": len(reader.pages),
            "pdf_kind": "mixed",
            "pipeline_version": "0.1.0",
            "status": "reviewing",
        },
        "candidates": candidates,
    }
