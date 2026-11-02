# Construction live validation record · 2 November 2026

## Current evidence

The private review tenant contains four **sample** construction projects, zero completed projects, zero eligible pre-completion forecast snapshots, zero model files and zero controlled drawing files. These counts were read inside Railway with tenant RLS enabled; no project record or file contents were exported. The temporary Railway SSH key was removed after the check. Other company workspaces were not inspected, so this is not a portfolio-wide production count.

Automated fixture checks pass for IFC parsing, model geometry comparisons, BCF 3.0 comments/viewpoints/snapshots round trips, OCR page extraction, exact-page citation checks and forecast cohort/drift calculations. They establish code behavior under controlled inputs, not performance on consultant files or completed projects.

## Live email infrastructure check · 2 November 2026

`updates.usepropbrew.com` is verified in Resend, with the required DKIM and sending CNAME records published through Namecheap. The production Propbrew app has `RESEND_API_KEY`, `EMAIL_FROM` (`Propbrew Construction <construction@updates.usepropbrew.com>`) and `RESEND_WEBHOOK_SECRET`; the signed webhook at `https://app.usepropbrew.com/api/webhooks/resend` is enabled. The live app health endpoint returned OK after deployment of commit `3e7bd44`.

Two controlled messages containing no customer or project data were submitted through the production sender configuration. Resend recorded `delivered@resend.dev` as **Delivered** (email ID `01a19b4c-1ed2-7e14-90a6-210674c516c6`; webhook event `msg_3LXiTYy20VPxEzOBViGw2fUtr2d`) and `bounced@resend.dev` as **Bounced** (email ID `01a19b4c-4d5b-7025-b684-3bc5240d4dcd`; webhook event `msg_3LXiV2NM5bLPqsFxl4oRgq34uy7`). Each signed webhook reached Propbrew once and received HTTP 200. These emails were sent directly through Resend's API with the deployed service's sender configuration, without a project transmittal or digest tag. They establish provider and callback connectivity, but they do **not** establish that a construction record changed status in PostgreSQL, that a PDF attachment arrived, or that an external recipient acknowledged it.

The production `NEXT_PUBLIC_SITE_URL` was changed to `https://app.usepropbrew.com` on 2 November 2026 so new transmittal and digest links use the intended app domain. `BETTER_AUTH_URL` still points to the Railway hostname; its session impact must be reviewed before changing it. The public acknowledgement link was verified in the non-demo pilot below.

## Non-demo delivery pilot · 2 November 2026

An isolated company, **Propbrew Construction Delivery Pilot**, and active project **Delivery Validation Pilot 2026** (`cp-new-1`) were created in the live application. All project names, amounts, site details and drawing geometry are synthetic. No customer project or real site evidence was used. The owner-controlled inbox received the test messages; `bounced@resend.dev` exercised hard-bounce handling.

Controlled drawing `QA-ARC-001`, revision A, was uploaded as a private PDF, approved inside the pilot and issued **for information**. Its stored SHA-256 is `f22fa4bcfb7cf96f3339e8df9f40fa246e857c7fb525502842e021503b17700b`. Gmail received the email with a 1,548-byte PDF attachment of the expected name and the same SHA-256 stated in the message. The app recorded the inbox issue as **delivered** after the signed provider callback. Its public `app.usepropbrew.com` link was opened and receipt acknowledged as **Propbrew Pilot Operator · Propbrew Internal QA**; the acknowledgement was visible after a fresh project reload. This is receipt evidence, not technical design approval.

The second issue was accepted, then **bounced** at the provider test address. One manual retry was recorded and accepted, then bounced again. The live audit trail contains issue creation, provider acceptance, delivered/bounced callbacks, retry and recipient acknowledgement events. After a fresh page load, the two transmittal statuses and acknowledgement persisted.

The pilot weekly digest for the week of 2 November was human-published to the owner-controlled inbox and the bounce-test address. The inbox received the text summary with source SHA-256 `69f2564b3639741d12ef4032ba224bcc8177d77ab33c7751ad4d8aecc8f9b22a`; the app recorded **delivered** and **bounced** callback states respectively. One manual retry of the bounced recipient was accepted and bounced again. Publication, recipient statuses, source fingerprint, coverage-gap acknowledgement and the retry events remained visible after reload and in the construction audit trail.

The live run found and resolved two delivery blockers: the app domain was absent from `PROPBREW_AUTH_ORIGINS`, preventing PDF uploads, and the public receipt form assumed reliable Origin/Referer headers in embedded mail browsers. Authenticated write routes retain their strict Origin check; the public receipt uses its 30-day HMAC-signed token as its write credential. The first immutable digest test snapshot also contained a false `99 days` missing-report warning and seven dates preceding this newly created project. Future previews now calculate missing reports and gap dates from the project start; the published test snapshot remains unchanged and should not be used as an operating report.

## Live acceptance gates

| Gate | Required evidence | Status |
| --- | --- | --- |
| External transmittal delivery | Verified sender, attached controlled PDF, tagged provider callbacks, retry audit and recipient acknowledgement | Passed in the isolated non-demo synthetic pilot. Real client document acceptance remains a separate UAT gate. |
| Weekly digest delivery | Reviewed project/week snapshot, named recipients, delivered/bounced callbacks, retry audit and durable publication after reload | Passed in the isolated non-demo synthetic pilot. The original test snapshot is retained with the pre-start gap defect noted above; future previews are corrected. |
| Forecast accuracy by type and region | At least 20 eligible **real completed** projects in each reported cohort; a forecast saved at least 14 days before closeout; final NGN actual cost, finish date, type and region | Open: review tenant has zero eligible outcomes |
| Drift review | Two non-overlapping ten-project completion windows; reviewer examines the alert, project mix and source changes | Open: insufficient eligible outcomes |
| Clash and BCF interoperability | Consultant-issued IFC/BCFZIP revision pair, recorded file provenance, element-level clash review, BCF export opened by the consultant's tool with comments, snapshots and viewpoints retained | Open: no consultant files supplied |
| OCR-grounded AI | Controlled scanned drawings/specifications; expert checks a sample of AI answers against the exact cited page image and records supported/unsupported findings | Open: no controlled files or named experts supplied |

## Operator procedure

1. Keep the verified Resend domain, Railway sender variables and webhook enabled. Its subscriptions include `email.delivered`, `email.bounced`, `email.delivery_delayed`, `email.complained`, `email.suppressed` and `email.failed`. Check all production domains and callback URLs before changing the app's public/auth origin.
2. From an authorised **non-demo** construction company account, issue one approved drawing PDF to each Resend test address. Save the transmittal ID, recipient, PDF SHA-256, provider email ID, webhook event ID, final PostgreSQL status and audit export. Verify the delivered link can be acknowledged; verify a bounced issue can be retried only after reviewing its address. Resend documents the two test recipients at <https://resend.com/changelog/sending-test-emails>.
3. Publish a weekly digest from a real active project to an authorised internal test recipient. Confirm the reviewed snapshot, coverage gaps and recipient status survive a restart. Review the received email against source records; a provider acceptance alone is not a delivery receipt.
4. For each real project outcome, confirm completion lifecycle event, positive NGN actual cost, type, region and a forecast captured at least 14 days before closeout. Review cohort holdout coverage and any drift signal with the project team. Do not label a cohort calibrated below 20 eligible outcomes.
5. Import consultant IFC revisions, run precise clash detection, review each candidate with the engineer, then export and reopen BCFZIP in the consultant's authoring tool. Keep original files and signed review findings.
6. Upload scanned approved drawings and specifications. Ask a fixed set of technical questions; have a qualified consultant mark each answer supported, unsupported or uncited against the cited page image. Record page, revision, answer and reviewer decision.

No fixture or sample result should be described as an independently validated engineering or forecasting result.
