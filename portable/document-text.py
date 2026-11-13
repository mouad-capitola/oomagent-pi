"""Bounded local PDF/DOCX extraction using pypdf and python-docx; no network/OCR."""
import json
import sys
from pathlib import Path

from docx import Document
from docx.text.paragraph import Paragraph
from pypdf import PdfReader


def extract(path):
    limit = 200_000
    page_count = None
    truncated = False
    if path.suffix.lower() == ".pdf":
        reader = PdfReader(path)
        if reader.is_encrypted:
            raise ValueError("Password-protected PDF is locked.")
        page_count = len(reader.pages)
        truncated = page_count > 200
        pieces = (reader.pages[i].extract_text() or "" for i in range(min(page_count, 200)))
    elif path.suffix.lower() == ".docx":
        document = Document(path)
        pieces = (block.text if isinstance(block, Paragraph) else "\n".join(
            "\t".join(cell.text for cell in row.cells) for row in block.rows
        ) for block in document.iter_inner_content())
    else:
        raise ValueError("Only .pdf and .docx documents are supported.")
    text = ""
    for piece in pieces:
        piece += "\n"
        remaining = limit - len(text)
        text += piece[:remaining]
        if len(piece) > remaining:
            truncated = True
            break
    return {"text": text, "pageCount": page_count, "extractionTruncated": truncated}


if __name__ == "__main__":
    try:
        print(json.dumps(extract(Path(sys.argv[1]))))
    except Exception:
        # Parser errors can contain document contents; do not forward them.
        print("Cannot extract this document. Check its format and encryption.", file=sys.stderr)
        sys.exit(1)
