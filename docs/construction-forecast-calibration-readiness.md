# Construction forecast calibration — engine verification and evidence readiness

**Date:** 10 November 2026
**Code under test:** `main` @ `91ae661` (post OCR-evidence merge)
**Tracker item:** `forecast-calibration` — *needs ≥20 real completed projects per cohort, forecast ≥14 days pre-closeout*
**Gate requirement** (docs/construction-live-validation-2026-11-02.md): *at least 20 eligible **real completed** projects in each reported cohort; a forecast saved at least 14 days before closeout; final NGN actual cost, finish date, type and region. Do not label a cohort calibrated below 20 eligible outcomes.*

---

## 1. What this record is — and is not

The gate is a **data gate**: only real completed projects with eligible pre-closeout forecasts can calibrate the forecast model. As of the 2 November 2026 live check, the review tenant had **zero eligible outcomes** — no synthetic run can change that.

What this record establishes: the calibration engine itself is **mathematically verified**, so the first real cohort that reaches 20 eligible outcomes will be scored correctly. Eight independent, hand-computed test cases (not captured from the implementation) now run in CI on every change.

Test file: `tests/domain/construction-forecast-calibration-verification.test.ts` (8 tests, deterministic, no AI or DB). Regression run: all 20 tests pass (8 new + 12 existing BIM/forecast tests).

## 2. Verified behaviour (all hand-computed expectations)

| Behaviour | Verified result |
|---|---|
| **14-day eligibility boundary** | Snapshot recorded exactly 14 days before closeout is eligible; 13 days is not; a snapshot after closeout is excluded |
| **Latest eligible snapshot** | Newest eligible snapshot wins; if the newest is inside the 14-day window, the engine falls back to the latest eligible one (finish error 3 days verified exactly) |
| **Invalid rows** | Zero / negative / non-integer actual costs skipped; invalid dates skipped; non-positive predicted cost skipped; duplicate outcomes counted once |
| **Cohort grouping** | Region matching is case-insensitive (`Lagos, Nigeria` = `LAGOS, NIGERIA`); unclassified outcomes counted separately (`unclassifiedTypeCount` / `unclassifiedRegionCount`) and excluded from cohorts |
| **Golden calibrated cohort (20 outcomes)** | 70/30 split → 14 training / 6 holdout; empirical 80th-percentile thresholds = 6 days and 4% (12th of 14 sorted); both holdout coverages 100% → `validationReady: true`, `calibrated: true`; MAE finish **3.6 days**, MAE cost **2.4%** — all values matched exactly |
| **Drift — absolute margin** | Previous-window finish error 3.0 → recent 4.2 days: +40% relative but +1.2 days absolute → `stable` (ratio alone never triggers) |
| **Drift — trigger boundary** | Previous 4.0 → recent 6.0 days: ≥1.25× **and** ≥2 days → `review_trigger`; at 5.0 recent (1.25×, +1 day) → `stable` |
| **Calibration ≠ drift** | A cohort can be fully calibrated while in `review_trigger` — the signals are independent, as designed |

Cross-tenant snapshot isolation and the below-20 refusal were already covered by the existing suite and re-verified in the same run.

## 3. Evidence protocol for real outcomes

For each real project to become an **eligible outcome** (the engine and the server-side gap report in `src/server/construction/forecast-evaluations.ts` require all of these):

1. **Completion lifecycle event** recorded (`action: complete`) with the closeout date.
2. **Positive NGN actual cost** across the project's cost codes (integer minor units).
3. **At least one forecast snapshot recorded ≥14 days before closeout** — the latest eligible snapshot is the one scored. Operationally: save a forecast at every monthly review and at every baseline revision; the system needs no special action beyond that.
4. **Project type** (residential / commercial / mixed_use / infrastructure / industrial / other) and **state or region** set, or the outcome only counts toward the unclassified totals.

**Cohort certification rules (verified):** a cohort becomes `validationReady` at 20 eligible outcomes; it is only `calibrated` when the last 30% of outcomes (chronological) fall within the training-derived 80% error band at ≥70% coverage on **both** finish-date and cost axes. A 19-outcome cohort is never labelled calibrated.

**Drift review** uses two non-overlapping ten-project windows and triggers only when recent mean absolute error worsens by ≥25% **and** ≥2 days (finish) or ≥5 percentage points (cost). Reviewer should examine the alert, project mix and source changes — the separate `drift-review` tracker item.

## 4. What remains to close the gate

1. Real completed projects accrue per the protocol above (this is elapsed project-delivery time, not engineering effort).
2. When a cohort approaches 20 eligible outcomes, review the per-project gap list on the forecast evaluation view and fix classification/closeout/cost gaps.
3. Record the first calibration review: cohort sizes, holdout coverages, drift state, reviewer name and decision. The golden cohort in §2 is the expected shape of a passing review.

No production code changed by this verification; no deployment impact.
