# Construction project acceptance journey

## Repeatable browser run

Run `node scripts/test-company-auth-e2e.mjs tests/e2e-company-auth/construction-acceptance.e2e.ts` from the repository root. The runner creates a disposable PostgreSQL server, applies current migrations, starts a local company-authenticated app, and removes its database and app copy afterward. It never uses customer records or provider credentials.

The browser journey creates a Lagos project and a second project for isolation. It mobilises the first with a WBS phase, task, NGN cost package and independently approved programme baseline; onboards and approves a Nigerian subcontractor; and signs in separate director, client, consultant, subcontractor, field-worker and quantity-surveyor accounts. The field worker records 25% task progress and receives a synced server receipt. Each project-scoped role sees the assigned project but not the second project. A separately signed-up company cannot open either the project or its private drawing PDF.

The commercial leg submits a ₦1,000,000 claim, assesses it as QS and certifies it as director. The ₦902,500 net amount remains an approved liability after 5% retention and 5% WHT on the post-retention value. Construction no longer imports statements or confirms payment from bank records.

The document leg creates a draft handover pack and checks that missing required files block submission. It uploads and approves five distinct controlled PDF revisions, issues one to an external test recipient, and verifies that the controlled issue is retained with an explicit failed-delivery state when the email provider is absent. The recipient address ends in `example.test`; no email is sent.

The weekly-digest browser journey (`tests/e2e-company-auth/construction-digest-publishing.e2e.ts`) uses a separate disposable company. It reviews missing-report dates, approves a source-fingerprinted digest for an explicit recipient, verifies that the publication and failed sender state survive a reload, and prevents a second publication in the same reporting week. Provider delivery remains a separate live gate.

The field worker uploads a real JPEG through the mobile construction API and syncs an evidence pack. The consultant's session retrieves the private photo; the test verifies its bytes and hash. The consultant reviews the evidence and approves the separate field decision. The owner links that approval to all five handover requirements, submits the completed pack, and cannot download it before sign-off. The consultant signs off independently. The browser downloads the ZIP, checks the sign-off trail and all five PDF hashes in its manifest, and confirms a second company cannot retrieve the pack. The disposable test stores the photo in PostgreSQL alongside the workspace and uses no customer records or external storage credentials.

## Remaining live acceptance gates

- **External delivery:** production lacks `RESEND_API_KEY`, `EMAIL_FROM` and `RESEND_WEBHOOK_SECRET`; the connected Resend account had no verified domains on 2 November 2026. Configure a verified sender and callback, then use Resend's `delivered@resend.dev` and `bounced@resend.dev` test recipients to verify provider acceptance, callback persistence, receipt acknowledgement, retry and audit export. The current run verifies signature checks, callback state transitions in tests, and safe failure with a retained issue; it does not prove a live delivered or bounced email.
- **Weekly digest:** publication, reviewer, source snapshot, coverage gaps and per-recipient delivery state now persist in the company workspace. Production sending remains blocked by the same missing verified email sender and callback. A manager must select and review actual recipients before sending.
- **Construction intelligence:** the private review tenant held four sample projects, zero completed projects, zero eligible forecast outcomes or snapshots, and no model or controlled drawing files on 2 November 2026. This cannot support type/region calibration, consultant IFC/BCF interoperability or expert OCR citation sign-off. Use the evidence plan in `docs/construction-live-validation-2026-11-02.md` with real company projects and consultant files.
- **Payment confirmation:** construction records certified liabilities but has no active settlement confirmation flow. Select and verify a non-banking payment source before treating approved claims, supplier invoices or retention releases as paid.
- **Client/consultant UAT:** named client and consultant users should independently review real source documents and sign the final handover pack. Automated role isolation alone cannot certify technical acceptance or physical site completion.

Keep these gates open in release reporting; a passing browser test is not evidence of external email delivery, settled payment or physical completion. The pack ZIP carries a recorded approval identity and timestamp, not a cryptographic digital signature.
