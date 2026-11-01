# Propbrew Construction Field

Native iOS and Android field app for assigned construction projects. This is a separate app from the Estate resident mobile experience. Both use the same Propbrew company login and production workspace records.

## Run

```bash
cd apps/construction-mobile
npm ci
EXPO_PUBLIC_API_URL=https://app.usepropbrew.com npm run start
```

For a local API, set `EXPO_PUBLIC_API_URL` to a reachable host address, not `localhost` on a physical phone. Build with `npm run ios` or `npm run android` after the native toolchains are installed. Configure signing and store distribution before a public release.

## Field workflow

1. Sign in with a company member assigned to the Construction workspace and at least one project. Accounts with TOTP MFA complete the authenticator-code step. Field workers see only assigned tasks; other roles see only their permitted projects and tasks.
2. The app caches a scoped project and task snapshot for offline use. Saved data and the outbox are separated by company and user ID. Sign-out retains unsent captures for that same account.
3. Record task progress, take a task evidence photo, or capture a site check-in. Photos are copied into persistent app storage before a queue entry is confirmed.
4. Sync runs on app foreground, every 20 seconds, and on demand. Each capture has one stable UUID. Uploaded photo URLs are saved after each upload, and a photo is deleted locally only after the server acknowledges the evidence record. Conflicts stay in the outbox with the server's reason; they are never silently overwritten.
5. Project Setup must contain a `site` location with latitude and longitude to enable check-in. The app requires a location fix of at most 75 m accuracy and the server checks a 200 m radius, a fresh fix and a seven-day offline window. It stores the site and distance, not raw coordinates. This is a **device location attestation**, which can be spoofed. It is displayed separately from manual crew attendance in Construction → Workforce and must not be treated as proof of physical presence or automatic payroll approval.

## Server routes

- `GET /api/mobile/v1/construction/bootstrap` — assigned projects, tasks and own check-ins.
- `POST /api/mobile/v1/construction/upload` — scoped task photo upload with an idempotent capture/photo index.
- `POST /api/mobile/v1/construction/sync` — strict validated, owner-bound, idempotent progress, evidence and check-in writes.
- `GET /api/construction/field-photos/:id` — authenticated, tenant-scoped photo retrieval.

The routes require the existing company session. They use the web app's construction permission and project/task scopes, durable workspace transaction, and sync ledger. Photo bytes are immutable PostgreSQL rows with row-level security, quota enforcement, backup coverage and a separate audit event. Migration `022_construction_field_photos.sql` must be applied before photo upload is enabled.

## Verification

```bash
npm run typecheck
npx expo export --platform ios --platform android --output-dir /tmp/propbrew-field-export
```

From the repository root, run `npx vitest run tests/construction/field-check-in.test.ts tests/data/offline-sync-actions.test.ts` for the location and sync rules. Device camera, GPS and reconnect behavior still require an iOS and Android device test before store release.
