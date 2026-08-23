from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from .parser import import_pdf


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Extract private AZ-104 PDF question candidates for human review."
    )
    parser.add_argument("pdf", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--max-questions", type=int, default=50)
    parser.add_argument("--exam-code", choices=["AZ-104", "AZ-305"], default="AZ-104")
    parser.add_argument("--schema", type=Path)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    if not args.pdf.is_file():
        raise SystemExit(f"PDF not found: {args.pdf}")
    if args.pdf.suffix.casefold() != ".pdf":
        raise SystemExit("Input must be a PDF file")
    if args.max_questions < 1:
        raise SystemExit("--max-questions must be positive")

    result = import_pdf(
        args.pdf, exam_code=args.exam_code, max_questions=args.max_questions
    )
    if args.schema:
        schema = json.loads(args.schema.read_text(encoding="utf-8"))
        validator = Draft202012Validator(schema, format_checker=FormatChecker())
        errors = [
            error.message
            for candidate in result["candidates"]
            for error in validator.iter_errors(candidate)
        ]
        if errors:
            raise SystemExit(f"Candidate schema validation failed: {errors[0]}")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    temporary_output = args.output.with_name(f".{args.output.name}.{os.getpid()}.tmp")
    temporary_output.write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    temporary_output.replace(args.output)

    candidates = result["candidates"]
    unknown = sum(item["type"] == "unknown" for item in candidates)
    cross_page = sum(
        "cross_page_merge" in item["quality"]["flags"] for item in candidates
    )
    print(
        json.dumps(
            {
                "output": str(args.output),
                "questions": len(candidates),
                "unknown": unknown,
                "cross_page": cross_page,
                "answers_missing": len(candidates),
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()
