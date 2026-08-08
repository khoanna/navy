#!/usr/bin/env python3
"""Independently verify the generated Navy SRCLA proposal DOCX package."""

from __future__ import annotations

import re
import sys
from dataclasses import dataclass
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from lxml import etree


W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
NS = {"w": W}
REQUIRED_PARTS = {
    "[Content_Types].xml",
    "_rels/.rels",
    "word/document.xml",
    "word/_rels/document.xml.rels",
    "word/styles.xml",
}

REQUIRED_TEXT = [
    "Navy – Ví blockchain tích hợp farming USDC tối ưu bằng thuật toán SRCLA trên Base",
    "ĐỀ CƯƠNG CHI TIẾT",
    "Safe, Robust, Cost-Aware Lending Allocator",
    "Base Sepolia",
    "Base mainnet fork",
    "Aave V3",
    "Compound III",
    "Moonwell",
    "ERC-4626",
    "walk-forward",
    "ThS. Nguyễn Tấn Toàn",
    "Nguyễn Ngọc Anh Khoa",
    "Trương Nguyễn Thùy Anh",
    "03/09/2026",
    "26/12/2026",
    "XÁC NHẬN",
]

ORDERED_HEADINGS = [
    "1. Lý do chọn đề tài",
    "2. Mục tiêu",
    "3. Phạm vi và đối tượng sử dụng",
    "4. Phương pháp thực hiện",
    "5. Nền tảng công nghệ",
    "6. Kết quả mong đợi",
    "7. Hướng phát triển",
    "8. Kế hoạch thực hiện",
    "XÁC NHẬN",
]

FORBIDDEN_TEXT = [
    "TBD",
    "TODO",
    "điền vô",
    "điền nha",
    "31/11",
    "Ethereum Sepolia",
    "MongoDB",
    "an toàn tuyệt đối",
    "cam kết lợi nhuận",
]


@dataclass(frozen=True)
class VerificationStats:
    paragraphs: int
    tables: int
    schedule_rows: int
    characters: int


def _element_text(element: etree._Element) -> str:
    values: list[str] = []
    for node in element.iter():
        if node.tag == f"{{{W}}}t" and node.text:
            values.append(node.text)
        elif node.tag == f"{{{W}}}tab":
            values.append("\t")
        elif node.tag in {f"{{{W}}}br", f"{{{W}}}cr"}:
            values.append("\n")
    return "".join(values).strip()


def _table_rows(table: etree._Element) -> list[list[str]]:
    rows: list[list[str]] = []
    for row in table.xpath("./w:tr", namespaces=NS):
        cells = [_element_text(cell) for cell in row.xpath("./w:tc", namespaces=NS)]
        rows.append(cells)
    return rows


def _document_order_text(root: etree._Element) -> tuple[str, int, list[etree._Element]]:
    body = root.find("w:body", namespaces=NS)
    if body is None:
        raise ValueError("word/document.xml has no body")
    parts: list[str] = []
    paragraph_count = 0
    tables: list[etree._Element] = []
    for child in body:
        if child.tag == f"{{{W}}}p":
            paragraph_count += 1
            text = _element_text(child)
            if text:
                parts.append(text)
        elif child.tag == f"{{{W}}}tbl":
            tables.append(child)
            for row in _table_rows(child):
                parts.append(" | ".join(row))
    return "\n".join(parts), paragraph_count, tables


def _parse_package(path: Path) -> tuple[dict[str, etree._Element], str | None]:
    try:
        with ZipFile(path) as archive:
            corrupt_member = archive.testzip()
            if corrupt_member:
                return {}, f"corrupt ZIP member: {corrupt_member}"
            names = set(archive.namelist())
            missing = sorted(REQUIRED_PARTS - names)
            if missing:
                return {}, f"missing required OOXML parts: {', '.join(missing)}"
            parsed: dict[str, etree._Element] = {}
            for name in sorted(names):
                if name.endswith(".xml") or name.endswith(".rels"):
                    try:
                        parsed[name] = etree.fromstring(archive.read(name))
                    except etree.XMLSyntaxError as error:
                        return {}, f"invalid XML in {name}: {error}"
            return parsed, None
    except (BadZipFile, OSError):
        return {}, "invalid DOCX archive"


def validate(docx_path: Path, source_path: Path) -> tuple[list[str], VerificationStats | None]:
    if not source_path.exists():
        return ["canonical source does not exist"], None
    if not docx_path.exists():
        return ["DOCX file does not exist"], None

    package, package_error = _parse_package(docx_path)
    if package_error:
        return [package_error], None
    document_root = package["word/document.xml"]
    text, paragraph_count, tables = _document_order_text(document_root)
    errors: list[str] = []

    source_text = source_path.read_text(encoding="utf-8")
    source_title_match = re.search(r"^# (.+)$", source_text, flags=re.MULTILINE)
    if not source_title_match or source_title_match.group(1) not in text:
        errors.append("DOCX title does not match canonical source")

    errors.extend(f"missing required text: {value}" for value in REQUIRED_TEXT if value not in text)
    for baseline in range(6):
        if f"B{baseline}" not in text:
            errors.append(f"missing baseline: B{baseline}")
    errors.extend(f"forbidden text present: {value}" for value in FORBIDDEN_TEXT if value in text)

    positions = [text.find(heading) for heading in ORDERED_HEADINGS]
    if any(position < 0 for position in positions):
        errors.append("one or more ordered headings are missing")
    elif positions != sorted(positions):
        errors.append("document headings or signature block are out of order")

    page_sizes = document_root.xpath("//w:sectPr/w:pgSz", namespaces=NS)
    if not page_sizes:
        errors.append("document has no page size")
    else:
        width = int(page_sizes[-1].get(f"{{{W}}}w", "0"))
        height = int(page_sizes[-1].get(f"{{{W}}}h", "0"))
        if not (11900 <= width <= 11912 and 16832 <= height <= 16844):
            errors.append(f"page size is not A4 portrait: {width}x{height} twips")

    if len(tables) < 3:
        errors.append(f"expected at least three tables, found {len(tables)}")
    schedule_rows: list[list[str]] = []
    for table in tables:
        rows = _table_rows(table)
        if rows and rows[0] == ["Giai đoạn", "Thời gian", "Công việc", "Kết quả"]:
            schedule_rows = rows
            grid_columns = table.xpath("./w:tblGrid/w:gridCol", namespaces=NS)
            if len(grid_columns) != 4:
                errors.append("schedule table does not define four columns")
            break
    if not schedule_rows:
        errors.append("four-column schedule table is missing")
    else:
        if len(schedule_rows) != 10:
            errors.append(f"expected nine schedule work rows, found {len(schedule_rows) - 1}")
        if len(schedule_rows) > 1 and "03/09/2026" not in schedule_rows[1][1]:
            errors.append("schedule does not start on 03/09/2026")
        if "26/12/2026" not in schedule_rows[-1][1]:
            errors.append("schedule does not end on 26/12/2026")

    stats = VerificationStats(
        paragraphs=paragraph_count,
        tables=len(tables),
        schedule_rows=max(0, len(schedule_rows) - 1),
        characters=len(text),
    )
    return errors, stats


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print("usage: verify_docx.py OUTPUT_DOCX SOURCE_MD", file=sys.stderr)
        return 2
    errors, stats = validate(Path(argv[1]), Path(argv[2]))
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    assert stats is not None
    print(
        "DOCX OK "
        f"paragraphs={stats.paragraphs} tables={stats.tables} "
        f"schedule_rows={stats.schedule_rows} characters={stats.characters}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
