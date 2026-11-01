# Construction project acceptance journey

## Repeatable browser run

Run `node scripts/test-company-auth-e2e.mjs tests/e2e-company-auth/construction-acceptance.e2e.ts` from the repository root. The runner creates a disposable PostgreSQL server, applies current migrations, starts a local company-authenticated app, and removes its database and app copy afterward. It never uses customer records or provider credentials.

The browser journey creates a Lagos project and a second project for isolation. It mobilises the first with a WBS phase, task, NGN cost package and independently approved programme baseline; onboards and approves a Nigerian subcontractor; and signs in separate director, client, consultant, subcontractor, field-worker, quantity-surveyor and two finance accounts. The field worker records 25% task progress and receives a synced server receipt. Each project-scoped role sees the assigned project but not the second project. A separately signed-up company cannot open either the project or its private drawing PDF.

The commercial leg submits a ₦1,000,000 claim, assesses it as QS, certifies it as director, imports a bank CSV debit for the ₦902,500 net payable after 5% retention and 5% WHT on the post-retention value, rejects review by the importer, approves the debit as a second finance officer and confirms the exact claim payment. No bank transfer is initiated by the test or by claim certification.

The document leg creates a draft handover pack and checks that missing required files block submission. It uploads and approves a real PDF revision, issues it to an external test recipient, and verifies that the controlled issue is retained with an explicit failed-delivery state when the email provider is absent. The recipient address ends in `example.test`; no email is sent.

## Remaining live acceptance gates

- **Completed handover in a browser:** the server workflow tests cover five distinct approved file revisions, omissions, superseded revisions, evidence-backed approval and independent final sign-off. The browser run currently proves the missing-file gate and one real approved PDF, but does not complete five uploads, field-photo custody, evidence review and signed pack download as one browser journey. Add this after a test object store is available.
- **External delivery:** production lacks `RESEND_API_KEY`, `EMAIL_FROM` and `RESEND_WEBHOOK_SECRET`. Configure a verified sender and callback, then use an approved test recipient to verify provider acceptance, delivered/bounced callback, receipt acknowledgement, retry and audit export. The current run verifies safe failure and retained issue only.
- **Bank confirmation:** the imported CSV is a controlled bank-statement fixture, not a connection to a bank. Verify a redacted real statement and separate finance reviewer in a dedicated staging company before operational sign-off.
- **Client/consultant UAT:** named client and consultant users should independently review real source documents and sign the final handover pack. Automated role isolation alone cannot certify technical acceptance or physical site completion.

Keep these gates open in release reporting; a passing browser test is not evidence of external email delivery, bank transfer, or physical completion.
