# Navy SRCLA Detailed Proposal DOCX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a polished `De-cuong-chi-tiet-Navy-SRCLA.docx` that preserves the source document's administrative form while rewriting its academic content around the Navy user wallet and SRCLA-centered USDC farming.

**Architecture:** Keep the approved proposal copy in a readable Markdown source, render a new DOCX through a focused `python-docx` build script, and validate the generated archive and extracted text with an independent verification script. Treat `De-cuong-chi-tiet.docx` as read-only and use it only as the visual/administrative reference.

**Tech Stack:** Markdown, Python 3, `python-docx`, `lxml`, OOXML/ZIP validation, shell verification with `unzip` and `xmllint`.

## Global Constraints

- The exact title is `Navy – Ví blockchain tích hợp farming USDC tối ưu bằng thuật toán SRCLA trên Base`.
- Preserve the institution, supervisor, student identities, signature area, and official dates from the approved design.
- The project application runs on Base Sepolia; algorithm evaluation uses at least 12 months of Base mainnet data and Base mainnet fork replays.
- The user wallet is the product center; SRCLA and the farming architecture are the principal technical/research contribution.
- Define SRCLA as `Safe, Robust, Cost-Aware Lending Allocator` and explain Safe, Robust, Cost-Aware, and its full deterministic pipeline.
- Keep QR payments, transfers, merchant, admin, and AI assistant as supporting functions.
- Do not claim production readiness, guaranteed profit, mainnet deployment with real funds, complete decentralization, account abstraction, or absolute safety.
- Keep `De-cuong-chi-tiet.docx` unchanged; generate `De-cuong-chi-tiet-Navy-SRCLA.docx` as a new file.
- Cover the exact schedule from 03/09/2026 through 26/12/2026; do not include invalid dates or open-ended maintenance phases.

---

### Task 1: Author and validate the canonical Vietnamese proposal copy

**Files:**
- Create: `docs/reports/navy-srcla-detailed-proposal.md`
- Create: `tools/docx_proposal/verify_source.py`

**Interfaces:**
- Consumes: approved decisions in `docs/superpowers/specs/2026-08-08-navy-srcla-detailed-proposal-rewrite-design.md`.
- Produces: UTF-8 Markdown with fixed `##` section headings and one four-column schedule table; `verify_source.py SOURCE_PATH` exits zero only when mandatory wording, section order, dates, and forbidden-placeholder checks pass.

- [ ] **Step 1: Write the source verifier first**

Create `tools/docx_proposal/verify_source.py` with explicit checks for:

```python
REQUIRED = [
    "Navy – Ví blockchain tích hợp farming USDC tối ưu bằng thuật toán SRCLA trên Base",
    "Safe, Robust, Cost-Aware Lending Allocator",
    "Base Sepolia",
    "Base mainnet fork",
    "Aave V3",
    "Compound III",
    "Moonwell",
    "03/09/2026",
    "26/12/2026",
]

FORBIDDEN = [
    "TBD", "TODO", "điền vô", "điền nha", "31/11",
    "an toàn tuyệt đối", "cam kết lợi nhuận",
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
```

The verifier must also require these SRCLA stages in order: `Thu thập trạng thái`, `Sàng lọc thị trường`, `Mô phỏng lợi suất sau phân bổ`, `Dự báo biên lợi suất thấp`, `Tính dự trữ thanh khoản`, `Tối ưu có ràng buộc`, `Kiểm tra chi phí`, `Thực thi theo giai đoạn và đối soát`. It must reject a schedule whose first date is not `03/09/2026` or final date is not `26/12/2026`.

- [ ] **Step 2: Run the verifier to confirm the source is absent**

Run: `python3 tools/docx_proposal/verify_source.py docs/reports/navy-srcla-detailed-proposal.md`

Expected: non-zero exit with `source file does not exist`.

- [ ] **Step 3: Write the complete canonical proposal**

Create `docs/reports/navy-srcla-detailed-proposal.md` in formal Vietnamese. Include:

- the approved title and administrative metadata;
- a user-wallet-centered motivation and a precise research gap against highest-APY farming;
- one general objective and measurable specific objectives;
- a clear main/supporting scope and exclusions;
- the SRCLA name, three properties, decision pipeline, ERC-4626/adapters/on-chain guardrail architecture, and the distinction between deterministic SRCLA and AI;
- the Base Sepolia product environment and Base mainnet fork evaluation environment;
- at least 12 months of time-ordered data, walk-forward evaluation, B0–B5 baselines, and metrics for net return, forecast, cost, turnover, drawdown, concentration, stressed liquidity, withdrawals, and safety violations;
- the exact technology stack from the approved design;
- measurable product, research, quality, security, and reproducibility outcomes;
- limitations and mainnet hardening as future work;
- a four-column schedule table with `Giai đoạn | Thời gian | Công việc | Kết quả`, covering consecutive intervals from 03/09/2026 to 26/12/2026.

The copy must identify QR payment, transfer, merchant, admin, and AI assistant as supporting functions. It must not retain obsolete Ethereum Sepolia, MongoDB, account-abstraction, gasless-farming, encrypted-subwallet, or open-ended maintenance statements from the source DOCX.

- [ ] **Step 4: Validate the source copy**

Run: `python3 tools/docx_proposal/verify_source.py docs/reports/navy-srcla-detailed-proposal.md`

Expected: exit zero and `SOURCE OK`.

- [ ] **Step 5: Review language and diff**

Run: `rg -n "TBD|TODO|điền|31/11|Ethereum Sepolia|MongoDB|an toàn tuyệt đối|cam kết lợi nhuận" docs/reports/navy-srcla-detailed-proposal.md`

Expected: no matches.

Run: `git diff --check -- docs/reports/navy-srcla-detailed-proposal.md tools/docx_proposal/verify_source.py`

Expected: no output.

- [ ] **Step 6: Commit the canonical content**

```bash
git add -f docs/reports/navy-srcla-detailed-proposal.md tools/docx_proposal/verify_source.py
git commit -m "docs: rewrite Navy SRCLA detailed proposal"
```

### Task 2: Build the DOCX while preserving the administrative form

**Files:**
- Create: `tools/docx_proposal/build_docx.py`
- Create: `tools/docx_proposal/test_build_docx.py`
- Read: `De-cuong-chi-tiet.docx`
- Read: `docs/reports/navy-srcla-detailed-proposal.md`
- Create: `De-cuong-chi-tiet-Navy-SRCLA.docx`

**Interfaces:**
- Consumes: `build_docx.py SOURCE_MD TEMPLATE_DOCX OUTPUT_DOCX` and the validated Markdown headings/table from Task 1.
- Produces: a valid WordprocessingML package with an administrative cover, academic body, four-column schedule, supervisor confirmation, date, and two-student signature block.

- [ ] **Step 1: Write structural build tests**

Create `tools/docx_proposal/test_build_docx.py` using `unittest` and `python-docx`. Tests must build into a temporary directory and assert:

```python
self.assertEqual(document.sections[0].page_height.mm, 297)
self.assertEqual(document.sections[0].page_width.mm, 210)
self.assertIn(EXACT_TITLE, all_text)
self.assertIn("ĐỀ CƯƠNG CHI TIẾT", all_text)
self.assertIn("ThS. Nguyễn Tấn Toàn", all_text)
self.assertIn("Nguyễn Ngọc Anh Khoa", all_text)
self.assertIn("Trương Nguyễn Thùy Anh", all_text)
self.assertGreaterEqual(len(document.tables), 3)
self.assertEqual(schedule.rows[0].cells[0].text, "Giai đoạn")
self.assertEqual(schedule.rows[0].cells[3].text, "Kết quả")
```

Also assert that body headings `1.` through `8.` occur in order, the signature section is after the schedule, and the output contains no empty placeholder strings from Task 1.

- [ ] **Step 2: Run the test to verify the builder is absent**

Run: `python3 -m unittest tools.docx_proposal.test_build_docx -v`

Expected: FAIL because `tools/docx_proposal/build_docx.py` does not exist.

- [ ] **Step 3: Implement the DOCX renderer**

Implement `tools/docx_proposal/build_docx.py` with these focused functions:

```python
def parse_source(path: Path) -> ProposalContent: ...
def configure_page(document: Document) -> None: ...
def configure_styles(document: Document) -> None: ...
def add_administrative_header(document: Document, content: ProposalContent) -> None: ...
def add_title_and_metadata(document: Document, content: ProposalContent) -> None: ...
def add_academic_body(document: Document, content: ProposalContent) -> None: ...
def add_schedule(document: Document, rows: list[ScheduleRow]) -> None: ...
def add_signature_block(document: Document, content: ProposalContent) -> None: ...
def build(source_md: Path, template_docx: Path, output_docx: Path) -> None: ...
```

Use the template as a reference package and create a new document with:

- A4 portrait pages;
- Times New Roman, 13 pt body text, 1.15 line spacing, justified paragraphs;
- bold numbered headings and consistent paragraph spacing;
- a borderless two-column institutional/national header;
- centered bold `ĐỀ CƯƠNG CHI TIẾT` and the exact topic title;
- a metadata block for supervisor, dates, and students;
- real Word bullet/numbered paragraphs rather than text glyphs;
- a repeating bold schedule header, visible borders, reasonable fixed widths, vertical centering, and rows allowed to span only when necessary;
- a page break before the schedule if the remaining space would split its heading from the table;
- a borderless signature table matching the source form's supervisor and two-student areas.

Do not overwrite the template. Write to a temporary output in the destination directory and replace only the exact output path after `Document(temp_path)` can reopen it successfully.

- [ ] **Step 4: Run structural build tests**

Run: `python3 -m unittest tools.docx_proposal.test_build_docx -v`

Expected: all tests pass.

- [ ] **Step 5: Generate the final DOCX**

Run:

```bash
python3 tools/docx_proposal/build_docx.py \
  docs/reports/navy-srcla-detailed-proposal.md \
  De-cuong-chi-tiet.docx \
  De-cuong-chi-tiet-Navy-SRCLA.docx
```

Expected: `WROTE De-cuong-chi-tiet-Navy-SRCLA.docx` and the source template hash remains unchanged.

- [ ] **Step 6: Commit the renderer and generated document**

```bash
git add -f tools/docx_proposal/build_docx.py tools/docx_proposal/test_build_docx.py De-cuong-chi-tiet-Navy-SRCLA.docx
git commit -m "docs: generate Navy SRCLA detailed proposal DOCX"
```

### Task 3: Independently verify content, OOXML integrity, and handoff quality

**Files:**
- Create: `tools/docx_proposal/verify_docx.py`
- Test: `De-cuong-chi-tiet-Navy-SRCLA.docx`
- Compare: `De-cuong-chi-tiet.docx`

**Interfaces:**
- Consumes: `verify_docx.py OUTPUT_DOCX SOURCE_MD`.
- Produces: exit zero and a report covering ZIP integrity, XML parsing, required/forbidden text, metadata, section/table structure, schedule boundaries, and source-template preservation.

- [ ] **Step 1: Implement the independent DOCX verifier**

Create `tools/docx_proposal/verify_docx.py` independently from the renderer. It must:

- run `ZipFile.testzip()` and reject any corrupt member;
- parse `word/document.xml`, headers, footers, relationships, styles, and content types with `lxml`;
- extract paragraph and table text in document order;
- compare mandatory terms and headings with the canonical Markdown;
- reject all forbidden placeholder/obsolete strings from Task 1;
- require A4 dimensions, at least three tables, a four-column schedule, signature names, official dates, and the final schedule date `26/12/2026`;
- require `Base Sepolia`, `Base mainnet fork`, the SRCLA expansion, Aave V3, Compound III, Moonwell, ERC-4626, B0–B5, and `walk-forward`;
- print counts for paragraphs, tables, schedule rows, and extracted characters.

- [ ] **Step 2: Run archive and XML checks**

Run: `unzip -t De-cuong-chi-tiet-Navy-SRCLA.docx`

Expected: `No errors detected`.

Run: `unzip -p De-cuong-chi-tiet-Navy-SRCLA.docx word/document.xml | xmllint --noout -`

Expected: exit zero with no output.

- [ ] **Step 3: Run the independent verifier**

Run:

```bash
python3 tools/docx_proposal/verify_docx.py \
  De-cuong-chi-tiet-Navy-SRCLA.docx \
  docs/reports/navy-srcla-detailed-proposal.md
```

Expected: exit zero and `DOCX OK` with non-zero paragraph, table, schedule-row, and extracted-character counts.

- [ ] **Step 4: Re-extract and manually inspect the final text**

Run:

```bash
unzip -p De-cuong-chi-tiet-Navy-SRCLA.docx word/document.xml \
  | perl -CS -0777 -pe 's{</w:p>}{\n}g; s{</w:tr>}{\n}g; s{<w:tab[^>]*/>}{\t}g; s{<w:br[^>]*/>}{\n}g; s{<[^>]+>}{}g; s/&amp;/\&/g; s/&lt;/</g; s/&gt;/>/g' \
  | sed -n '1,520p'
```

Expected: complete, ordered Vietnamese copy with no truncation, duplicated sections, placeholders, obsolete scope, or malformed schedule dates.

- [ ] **Step 5: Run the complete verification gate**

Run:

```bash
python3 tools/docx_proposal/verify_source.py docs/reports/navy-srcla-detailed-proposal.md
python3 -m unittest tools.docx_proposal.test_build_docx -v
python3 tools/docx_proposal/verify_docx.py De-cuong-chi-tiet-Navy-SRCLA.docx docs/reports/navy-srcla-detailed-proposal.md
git diff --check
```

Expected: both verifiers report OK, all unit tests pass, and `git diff --check` reports no whitespace errors.

- [ ] **Step 6: Commit verification tooling**

```bash
git add -f tools/docx_proposal/verify_docx.py
git commit -m "test: verify Navy SRCLA proposal DOCX"
```

- [ ] **Step 7: Hand off the final document**

Report the absolute clickable path to `De-cuong-chi-tiet-Navy-SRCLA.docx`, confirm that `De-cuong-chi-tiet.docx` was not modified, summarize the content focus and environment split, and include the exact verification commands and results.
