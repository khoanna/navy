#!/usr/bin/env python3
"""Validate the canonical Markdown source for the Navy SRCLA proposal."""

from __future__ import annotations

import sys
from pathlib import Path


REQUIRED = [
    "Navy – Ví blockchain tích hợp farming USDC tối ưu bằng thuật toán SRCLA trên Base",
    "Safe, Robust, Cost-Aware Lending Allocator",
    "Base Sepolia",
    "Base mainnet fork",
    "Aave V3",
    "Compound III",
    "Moonwell",
    "ERC-4626",
    "walk-forward",
    "03/09/2026",
    "26/12/2026",
]

FORBIDDEN = [
    "TBD",
    "TODO",
    "điền vô",
    "điền nha",
    "31/11",
    "an toàn tuyệt đối",
    "cam kết lợi nhuận",
    "Ethereum Sepolia",
    "MongoDB",
]

ORDERED_HEADINGS = [
    "## 1. Lý do chọn đề tài",
    "## 2. Mục tiêu",
    "## 3. Phạm vi và đối tượng sử dụng",
    "## 4. Phương pháp thực hiện",
    "## 5. Nền tảng công nghệ",
    "## 6. Kết quả mong đợi",
    "## 7. Hướng phát triển",
    "## 8. Kế hoạch thực hiện",
]

PIPELINE = [
    "Thu thập trạng thái",
    "Sàng lọc thị trường",
    "Mô phỏng lợi suất sau phân bổ",
    "Dự báo biên lợi suất thấp",
    "Tính dự trữ thanh khoản",
    "Tối ưu có ràng buộc",
    "Kiểm tra chi phí",
    "Thực thi theo giai đoạn và đối soát",
]


def positions_in_order(text: str, values: list[str], label: str) -> list[str]:
    """Return errors for missing or out-of-order values."""
    errors: list[str] = []
    positions: list[int] = []
    for value in values:
        position = text.find(value)
        if position < 0:
            errors.append(f"missing {label}: {value}")
        positions.append(position)
    present_positions = [position for position in positions if position >= 0]
    if present_positions != sorted(present_positions):
        errors.append(f"{label} values are out of order")
    return errors


def schedule_rows(text: str) -> list[list[str]]:
    """Extract non-separator rows from the four-column Markdown schedule."""
    rows: list[list[str]] = []
    in_schedule = False
    for line in text.splitlines():
        if line == "## 8. Kế hoạch thực hiện":
            in_schedule = True
            continue
        if not in_schedule or not line.startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 4 or all(set(cell) <= {"-", ":"} for cell in cells):
            continue
        rows.append(cells)
    return rows


def validate(path: Path) -> list[str]:
    if not path.exists():
        return ["source file does not exist"]

    text = path.read_text(encoding="utf-8")
    errors = [f"missing required text: {value}" for value in REQUIRED if value not in text]
    errors.extend(f"forbidden text present: {value}" for value in FORBIDDEN if value in text)
    errors.extend(positions_in_order(text, ORDERED_HEADINGS, "heading"))
    errors.extend(positions_in_order(text, PIPELINE, "SRCLA pipeline"))

    rows = schedule_rows(text)
    if not rows or rows[0] != ["Giai đoạn", "Thời gian", "Công việc", "Kết quả"]:
        errors.append("schedule must start with the required four-column header")
    elif len(rows) < 3:
        errors.append("schedule must include at least two work rows")
    else:
        if not rows[1][1].startswith("03/09/2026"):
            errors.append("schedule must start on 03/09/2026")
        if not rows[-1][1].endswith("26/12/2026"):
            errors.append("schedule must end on 26/12/2026")
    return errors


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: verify_source.py SOURCE_PATH", file=sys.stderr)
        return 2
    errors = validate(Path(argv[1]))
    if errors:
        for error in errors:
            print(f"ERROR: {error}", file=sys.stderr)
        return 1
    print("SOURCE OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
