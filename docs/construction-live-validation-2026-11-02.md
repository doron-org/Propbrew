# Construction live validation record · 2 November 2026

## Current evidence

The private review tenant contains four **sample** construction projects, zero completed projects, zero eligible pre-completion forecast snapshots, zero model files and zero controlled drawing files. These counts were read inside Railway with tenant RLS enabled; no project record or file contents were exported. The temporary Railway SSH key was removed after the check. Other company workspaces were not inspected, so this is not a portfolio-wide production count.

Automated fixture checks pass for IFC parsing, model geometry comparisons, BCF 3.0 comments/viewpoints/snapshots round trips, OCR page extraction, exact-page citation checks and forecast cohort/drift calculations. They establish code behavior under controlled inputs, not performance on consultant files or completed projects.

## Live acceptance gates

| Gate | Required evidence | Status |
| --- | --- | --- |
| External transmittal delivery | Verified Resend domain and sender, configured signed webhook, provider email IDs, `delivered@resend.dev` and `bounced@resend.dev` callbacks, retry audit, external receipt acknowledgement | Open: sender/domain/webhook unavailable |
| Weekly digest delivery | Manager-approved project/week snapshot, named recipients, provider acceptance and delivered/bounced callbacks, durable publication after reload | Publication and safe-failure paths built; live delivery open |
| Forecast accuracy by type and region | At least 20 eligible **real completed** projects in each reported cohort; a forecast saved at least 14 days before closeout; final NGN actual cost, finish date, type and region | Open: review tenant has zero eligible outcomes |
| Drift review | Two non-overlapping ten-project completion windows; reviewer examines the alert, project mix and source changes | Open: insufficient eligible outcomes |
| Clash and BCF interoperability | Consultant-issued IFC/BCFZIP revision pair, recorded file provenance, element-level clash review, BCF export opened by the consultant's tool with comments, snapshots and viewpoints retained | Open: no consultant files supplied |
| OCR-grounded AI | Controlled scanned drawings/specifications; expert checks a sample of AI answers against the exact cited page image and records supported/unsupported findings | Open: no controlled files or named experts supplied |

## Operator procedure

1. Connect Resend with a sender domain owned by Propbrew. Add `RESEND_API_KEY`, `EMAIL_FROM` and `RESEND_WEBHOOK_SECRET` in Railway without pasting credentials into a ticket or chat. Register `https://app.usepropbrew.com/api/webhooks/resend` for `email.delivered`, `email.bounced`, `email.delivery_delayed`, `email.complained` and `email.suppressed`.
2. Issue one approved drawing PDF to each Resend test address. Save the transmittal ID, recipient, PDF SHA-256, provider email ID, webhook event ID, final status and audit export. Verify the delivered link can be acknowledged; verify a bounced issue can be retried only after reviewing its address. Resend documents the two test recipients at <https://resend.com/changelog/sending-test-emails>.
3. Publish a weekly digest from a real active project to an authorised internal test recipient. Confirm the reviewed snapshot, coverage gaps and recipient status survive a restart. Review the received email against source records; a provider acceptance alone is not a delivery receipt.
4. For each real project outcome, confirm completion lifecycle event, positive NGN actual cost, type, region and a forecast captured at least 14 days before closeout. Review cohort holdout coverage and any drift signal with the project team. Do not label a cohort calibrated below 20 eligible outcomes.
5. Import consultant IFC revisions, run precise clash detection, review each candidate with the engineer, then export and reopen BCFZIP in the consultant's authoring tool. Keep original files and signed review findings.
6. Upload scanned approved drawings and specifications. Ask a fixed set of technical questions; have a qualified consultant mark each answer supported, unsupported or uncited against the cited page image. Record page, revision, answer and reviewer decision.

No fixture or sample result should be described as an independently validated engineering or forecasting result.
