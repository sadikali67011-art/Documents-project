import unittest

from docqa import (
    DocumentChunk,
    chunk_text,
    extract_document,
    extractive_summary,
    is_summary_question,
    rank_chunks,
)


class DocumentQaTests(unittest.TestCase):
    def test_extracts_utf8_text(self):
        self.assertEqual(
            extract_document("notes.txt", "Hello document".encode("utf-8")),
            "Hello document",
        )

    def test_chunks_long_text_with_overlap(self):
        text = "alpha beta gamma delta epsilon " * 20
        chunks = chunk_text(text, "notes.txt", max_chars=80, overlap=15)
        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(len(chunk.text) <= 80 for chunk in chunks))
        self.assertEqual([chunk.chunk_id for chunk in chunks], list(range(1, len(chunks) + 1)))

    def test_retrieval_prefers_relevant_passage(self):
        chunks = [
            DocumentChunk("policy.txt", 1, "Employees receive 20 days of annual leave."),
            DocumentChunk("policy.txt", 2, "The office is closed on public holidays."),
        ]
        results = rank_chunks("How many days of annual leave?", chunks)
        self.assertTrue(results)
        self.assertEqual(results[0][0].chunk_id, 1)

    def test_no_match_returns_empty_results(self):
        chunks = [DocumentChunk("policy.txt", 1, "The office is closed on public holidays.")]
        self.assertEqual(rank_chunks("What is the annual leave allowance?", chunks), [])

    def test_summary_question_recognizes_hinglish_and_english(self):
        self.assertTrue(is_summary_question("meri CV kya hai ye"))
        self.assertTrue(is_summary_question("Summarize my resume"))
        self.assertTrue(is_summary_question("my cv ditals"))
        self.assertFalse(is_summary_question("How many leave days?"))

    def test_extractive_summary_prioritizes_resume_sections(self):
        chunks = [
            DocumentChunk(
                "cv.txt",
                1,
                "Welcome to my profile. I have five years of software experience. "
                "I studied computer science.",
            )
        ]
        summary = extractive_summary(chunks, max_sentences=2)
        self.assertEqual(len(summary), 2)
        self.assertIn("experience", summary[0][1])
        self.assertIn("studied", summary[1][1])


if __name__ == "__main__":
    unittest.main()
