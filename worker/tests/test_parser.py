import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from az_exam_importer.parser import (
    ParsedQuestion,
    candidate_from_question,
    infer_question_type,
    parse_question_pages,
    split_stem_and_options,
)


class ParserTests(unittest.TestCase):
    def test_parses_question_and_continuation_page(self) -> None:
        pages = [
            (
                1,
                "Exam AZ-104\nTopic 2\nQuestion #48\nHOTSPOT -\nScenario text",
            ),
            (2, "Continuation text\nHot Area:"),
            (3, "Topic 2\nQuestion #49\nQuestion text\nA.\nYes\nB.\nNo"),
        ]

        questions = parse_question_pages(pages)

        self.assertEqual(len(questions), 2)
        self.assertEqual(questions[0].pages, [1, 2])
        self.assertIn("Continuation text", questions[0].raw_text)
        self.assertEqual(questions[1].number, 49)

    def test_splits_options_when_labels_are_separate_lines(self) -> None:
        stem, options = split_stem_and_options(
            "What should you do?\nA.\nFirst option\nB.\nSecond option"
        )

        self.assertEqual(stem, "What should you do?")
        self.assertEqual(options, [("A", "First option"), ("B", "Second option")])

    def test_skips_blank_separator_but_keeps_image_only_page(self) -> None:
        pages = [
            (1, "Topic 1\nQuestion #1\nQuestion text", False),
            (2, "", False),
            (3, "", True),
            (4, "Topic 1\nQuestion #2\nNext question", False),
        ]

        questions = parse_question_pages(pages)

        self.assertEqual(questions[0].pages, [1, 3])
        self.assertEqual(questions[0].empty_pages, [3])

    def test_classifies_yes_no_as_true_false(self) -> None:
        self.assertEqual(
            infer_question_type("Does this meet the goal?", [("A", "Yes"), ("B", "No")]),
            "true_false",
        )

    def test_hotspot_is_unknown(self) -> None:
        self.assertEqual(infer_question_type("HOTSPOT - choose in Hot Area", []), "unknown")

    def test_multiple_choice_hint(self) -> None:
        self.assertEqual(
            infer_question_type(
                "Which two resources should you choose?",
                [("A", "One"), ("B", "Two"), ("C", "Three")],
            ),
            "multiple_choice",
        )

    def test_question_id_is_stable_and_page_sensitive(self) -> None:
        base = ParsedQuestion(topic=5, number=149, pages=[680], raw_parts=["HOTSPOT"])
        duplicate_number = ParsedQuestion(
            topic=5, number=149, pages=[681], raw_parts=["Different HOTSPOT"]
        )
        kwargs = {
            "document_id": "11111111-1111-1111-1111-111111111111",
            "bank_id": "22222222-2222-2222-2222-222222222222",
            "exam_code": "AZ-104",
        }

        first = candidate_from_question(base, **kwargs)
        repeated = candidate_from_question(base, **kwargs)
        second_occurrence = candidate_from_question(duplicate_number, **kwargs)

        self.assertEqual(first["question_id"], repeated["question_id"])
        self.assertNotEqual(first["question_id"], second_occurrence["question_id"])

    def test_unreviewed_image_candidate_conforms_to_schema(self) -> None:
        candidate = candidate_from_question(
            ParsedQuestion(topic=1, number=1, pages=[1], raw_parts=["HOTSPOT"]),
            document_id="11111111-1111-1111-1111-111111111111",
            bank_id="22222222-2222-2222-2222-222222222222",
            exam_code="AZ-104",
        )
        schema_path = Path(__file__).parents[2] / "contracts" / "question-candidate.schema.json"
        schema = json.loads(schema_path.read_text(encoding="utf-8"))

        Draft202012Validator(schema, format_checker=FormatChecker()).validate(candidate)


if __name__ == "__main__":
    unittest.main()
