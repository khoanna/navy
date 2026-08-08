#!/usr/bin/env python3
"""Behavior tests for the independent proposal DOCX verifier."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VERIFIER = ROOT / "tools/docx_proposal/verify_docx.py"
OUTPUT = ROOT / "De-cuong-chi-tiet-Navy-SRCLA.docx"
SOURCE = ROOT / "docs/reports/navy-srcla-detailed-proposal.md"


class VerifyDocxTest(unittest.TestCase):
    def run_verifier(self, docx_path: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(VERIFIER), str(docx_path), str(SOURCE)],
            cwd=ROOT,
            capture_output=True,
            text=True,
            check=False,
        )

    def test_accepts_generated_proposal(self) -> None:
        """Catches false rejection of a complete, structurally valid proposal."""
        result = self.run_verifier(OUTPUT)
        self.assertEqual(result.returncode, 0, result.stderr or result.stdout)
        self.assertIn("DOCX OK", result.stdout)

    def test_rejects_corrupt_archive(self) -> None:
        """Catches a verifier that treats an unreadable file as a valid DOCX."""
        with tempfile.TemporaryDirectory() as temp_dir:
            corrupt = Path(temp_dir) / "corrupt.docx"
            corrupt.write_bytes(b"not a ZIP archive")
            result = self.run_verifier(corrupt)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("invalid DOCX archive", result.stderr)


if __name__ == "__main__":
    unittest.main()
