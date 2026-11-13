"""Real local extraction tests; run with ./tools python3 tests/document-portable.py."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

from docx import Document
from pypdf import PdfWriter

spec = importlib.util.spec_from_file_location("document_text", Path(__file__).resolve().parents[1] / "portable/document-text.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class Documents(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_docx_text_table_and_unicode(self):
        path = self.root / "notes.docx"
        doc = Document()
        doc.add_paragraph("Hello wereld 🌍")
        doc.add_table(rows=1, cols=1).cell(0, 0).text = "Table content"
        doc.save(path)
        result = module.extract(path)
        self.assertIn("Hello wereld 🌍", result["text"])
        self.assertIn("Table content", result["text"])
        self.assertFalse(result["extractionTruncated"])

    def test_character_limit(self):
        path = self.root / "large.docx"
        doc = Document()
        doc.add_paragraph("a" * 200_001)
        doc.save(path)
        result = module.extract(path)
        self.assertEqual(len(result["text"]), 200_000)
        self.assertTrue(result["extractionTruncated"])

    def test_pdf_page_limit_and_locked_pdf(self):
        path = self.root / "pages.pdf"
        writer = PdfWriter()
        for _ in range(201):
            writer.add_blank_page(width=100, height=100)
        writer.write(path)
        result = module.extract(path)
        self.assertEqual(result["pageCount"], 201)
        self.assertTrue(result["extractionTruncated"])
        writer.encrypt("synthetic-password")
        writer.write(path)
        with self.assertRaisesRegex(ValueError, "locked"):
            module.extract(path)


if __name__ == "__main__":
    unittest.main()
