# OCR-grounded AI — supported/unsupported sign-off evidence pack

**Date:** 7 November 2026
**Code under test:** `main` @ `11048ae` (post-merge of the CI repair branch)
**Tracker item:** `ocr-signoff` — *OCR-grounded AI: expert supported/unsupported sign-off against scanned controlled drawings*
**Gate requirement** (docs/construction-live-validation-2026-11-02.md, step 6): *upload scanned approved drawings and specifications; ask a fixed set of technical questions; mark each answer supported, unsupported or uncited against the cited page image; record page, revision, answer and reviewer decision.*

---

## 1. What was exercised

The **real production code path**, end to end, with only tenancy/budget seams mocked (feature flag on, budget allowed, evaluations captured). Every AI call went to the real configured provider (`gpt-6-luna` via the direct OpenAI connection — the same provider resolution order production uses):

1. **Vision OCR** — `src/server/construction/document-ocr.ts` transcribed raster page PNGs.
2. **Extraction/indexing** — `src/server/construction/document-text.ts` (`extractConstructionPdfForIndex`) detected the pages had no usable text layer and routed them through OCR.
3. **Answer generation** — `streamCopilotAnswer` with the production copilot instruction template (verbatim copy from `src/server/ai/copilot.ts` @ `11048ae`, `limited = false` branch) over a production-shaped `CopilotContext` whose `documentExcerpts` and page sources were built exactly as `buildConstructionCopilotContext` builds them.
4. **Grounding evaluation** — `src/server/construction/document-answer-evaluation.ts` graded every document claim in each answer against the exact cited page excerpts (supported / unsupported / uncited / unclear) and recorded evaluations (`construction_document_grounding`, dataset `page-citation-v1`).
5. **Independent visual check** — every cited claim was then verified against the actual cited page image (the exact PNG the OCR saw), independently of the AI grader.

Harness: `tests/ai/ocr-signoff-harness.test.ts` + `tests/ai/ocr-signoff-drawing-factory.ts` (guarded by `RUN_OCR_SIGNOFF=1` + `OPENAI_API_KEY`; skipped in CI). Fixture self-check: `tests/ai/ocr-signoff-fixture-smoke.test.ts` (always runs; asserts the PDFs are raster-only).

## 2. Test corpus — synthetic scanned controlled drawings

Three single/multi-page **image-only** PDFs (no text layer, verified: 0 characters extractable per page), drawn with known ground truth and light scan noise:

| Document | Rev | Pages | Discipline |
|---|---|---|---|
| QA-ARC-201 · Ground Floor Plan | C | 1 | Architectural |
| LAG-SPEC-104 · Waterproofing Specification | B | 2 | Specification |
| QA-STR-110 · Foundation Layout | A | 1 | Structural |

Corpus is synthetic — it validates pipeline behaviour, not a real engineering record. Cited page images: `ocr-grounded-ai-signoff-2026-11-07/pages/`.

## 3. OCR fidelity vs known ground truth

| Page | Method | Ground-truth strings found |
|---|---|---|
| QA-ARC-201 p1 | ocr | 7/7 (drawing no., all three room dims, wall spec, door size, GLA) |
| LAG-SPEC-104 p1 | ocr | 7/7 (section, clauses 7.12.1–7.12.3, 2 mm, 100 mm, 0.3 L/m2) |
| LAG-SPEC-104 p2 | ocr | 6/6 (section, clauses 7.13.1–7.13.3, 72 hours, L/500, signatory) |
| QA-STR-110 p1 | ocr | 6/6 (drawing no., C30/37, Y16 @ 200, footing dims, blinding, bearing) |

**20/20 required strings transcribed; 0 pending pages; 0 OCR errors.** Revision labels and drawing numbers preserved per the OCR system prompt contract. Raw record: `ocr-grounded-ai-signoff-2026-11-07/ocr-fidelity.json`.

## 4. Fixed question set — answers, AI verdicts, independent visual check

| # | Question (abridged) | Answer claim(s) | Cited page | AI grader | Visual check | Agree |
|---|---|---|---|---|---|---|
| 1 | Membrane thickness + clause | 2 mm torch-applied bituminous sheet, Clause 7.12.1 | LAG-SPEC-104 rev B p1 | supported | **Supported** — page shows exactly this | ✓ |
| 2 | Foundation concrete grade | C30/37 | QA-STR-110 rev A p1 | supported | **Supported** | ✓ |
| 3 | Living room dimensions | 4200 × 3600 (mm by convention) | QA-ARC-201 rev C p1 | supported | **Supported** — page shows "4200 x 3600"; note: units unstated on drawing, mm inferred per 1:100 convention | ✓ |
| 4 | Flood-test duration + signatory | 72 hours before screed; records signed by consultant engineer | LAG-SPEC-104 rev B p2 | supported (2/2) | **Supported** — clauses 7.13.1 / 7.13.3 | ✓ |
| 5 | Footing F1 reinforcement | Y16 @ 200 c/c both ways bottom | QA-STR-110 rev A p1 | supported | **Supported** | ✓ |
| 6 | **Trap:** specified pile depth | "Does not specify pile depth; F1 is 450 mm and F2 400 mm deep pad footings" | QA-STR-110 rev A p1 | needs_review (2/3: two supported, one **unclear**) | **All three claims correct** — the page contains no pile data; the absence claim is true | ✓* |

\* Q6: the grader marked the *absence* claim ("does not specify pile depth") `unclear` — conservative and defensible (a grader cannot prove a negative from an excerpt), and it correctly forced the answer to `needs_review` for human attention. Counted as agreement on substance.

**Totals: 9 claims checked, 9/9 agreement between the AI grader and the independent visual check; 5/6 answers fully supported; the one answer about absent content was honest and correctly flagged for review.** Full answers and recorded evaluations: `ocr-grounded-ai-signoff-2026-11-07/answers-and-verdicts.json`.

## 5. Behavioural findings

- OCR path triggers correctly only when the text layer is unusable (<120 chars); raster-only pages went through vision OCR as designed.
- Citation contract works: every claim carried the exact `NUMBER · Title rev X · PDF page N` label; `validateDocumentFindings`' uncited downgrade was not needed but is covered by existing unit tests.
- No hallucinated dimensions/quantities/clauses in any answer; the trap question produced an explicit non-verifiability statement, per the system prompt.
- Cost guardrails engaged on every call (budget reserve → finish), with redacted ledger entries.

## 6. Deviations and limits

- **Synthetic corpus**, generated for this run. The live gate still requires real controlled scanned drawings/specifications from an actual project and a **named qualified expert** confirming the verdicts (this pack is the prepared evidence and protocol for that review).
- Tenancy, feature-flag, budget-ledger and evaluation-recording seams were mocked; all AI calls were real. Retrieval ranking (`retrieveConstructionDocumentText`) was not exercised — all 4 pages were authorised excerpts; ranking is covered by existing unit tests.
- The copilot instruction template was copied verbatim into the harness (not imported); provenance: `src/server/ai/copilot.ts` @ `11048ae`.
- The answer grader is a triage aid per its own contract — "never a technical approval or proof of the underlying OCR". This pack is evidence of pipeline behaviour, not engineering certification.

## 7. What remains to close the gate

1. Upload 2–3 real scanned controlled drawings/specifications to a non-demo company (the account created 6 Nov 2026 can host this).
2. Run the same fixed question set (or adapt this harness against the live workspace).
3. A named qualified consultant confirms/overrides each verdict against the cited page image; record reviewer name, page, revision, decision — the table in §4 is the ready-made format.

## Reproduction

```bash
cd <repo>
export OPENAI_API_KEY=…
RUN_OCR_SIGNOFF=1 OCR_SIGNOFF_OUT=/tmp/propbrew-ocr-signoff \
  npx vitest run tests/ai/ocr-signoff-harness.test.ts
```

Artifacts written by a run: `ocr-fidelity.json`, `answers-and-verdicts.json` (full answers, verdicts, recorded evaluations), `pages/*.png` (cited page images), `pdfs/*.pdf` (scans as OCR'd). The 2026-11-07 run's artifacts (minus regenerable PDFs) are committed under `docs/ocr-grounded-ai-signoff-2026-11-07/`.
