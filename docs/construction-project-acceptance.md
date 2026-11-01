# Construction project acceptance journey

## Repeatable browser run

Run `node scripts/test-company-auth-e2e.mjs tests/e2e-company-auth/construction-acceptance.e2e.ts` from the repository root. The runner creates a disposable PostgreSQL server, applies current migrations, starts a local company-authenticated app, and removes its database and app copy afterward. It never uses customer records or provider credentials.

The browser journey creates a Lagos project and a second project for isolation. It mobilises the first with a WBS phase, task, NGN cost package and independently approved programme baseline; onboards and approves a Nigerian subcontractor; and signs in separate director, client, consultant, subcontractor, field-worker and quantity-surveyor accounts. The field worker records 25% task progress and receives a synced server receipt. Each project-scoped role sees the assigned project but not the second project. A separately signed-up company cannot open either the project or its private drawing PDF.

The commercial leg submits a ₦1,000,000 claim, assesses it as QS and certifies it as director. The ₦902,500 net amount remains an approved liability after 5% retention and 5% WHT on the post-retention value. Construction no longer imports statements or confirms payment from bank records.

The document leg creates a draft handover pack and checks that missing required files block submission. It uploads and approves five distinct controlled PDF revisions, issues one to an external test recipient, and verifies that the controlled issue is retained with an explicit failed-delivery state when the email provider is absent. The recipient address ends in `example.test`; no email is sent.

The field worker uploads a real JPEG through the mobile construction API and syncs an evidence pack. The consultant's session retrieves the private photo; the test verifies its bytes and hash. The consultant reviews the evidence and approves the separate field decision. The owner links that approval to all five handover requirements, submits the completed pack, and cannot download it before sign-off. The consultant signs off independently. The browser downloads the ZIP, checks the sign-off trail and all five PDF hashes in its manifest, and confirms a second company cannot retrieve the pack. The disposable test stores the photo in PostgreSQL alongside the workspace and uses no customer records or external storage credentials.

## Remaining live acceptance gates

- **External delivery:** production lacks `RESEND_API_KEY`, `EMAIL_FROM` and `RESEND_WEBHOOK_SECRET`. Configure a verified sender and callback, then use an approved test recipient to verify provider acceptance, delivered/bounced callback, receipt acknowledgement, retry and audit export. The current run verifies safe failure and retained issue only.
- **Payment confirmation:** construction records certified liabilities but has no active settlement confirmation flow. Select and verify a non-banking payment source before treating approved claims, supplier invoices or retention releases as paid.
- **Client/consultant UAT:** named client and consultant users should independently review real source documents and sign the final handover pack. Automated role isolation alone cannot certify technical acceptance or physical site completion.

Keep these gates open in release reporting; a passing browser test is not evidence of external email delivery, settled payment or physical completion. The pack ZIP carries a recorded approval identity and timestamp, not a cryptographic digital signature.
