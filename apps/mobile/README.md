# Propbrew native mobile

The Expo app serves two authorised workspaces through the same company account and PostgreSQL-backed API as Propbrew web:

- **Construction Field:** assigned projects and tasks, task progress, site photos, location-checked attendance, and an offline outbox.
- **Estate:** the existing resident and tenant experience.

Construction access comes from the member's company role and project/task assignments in **Team & access**. The server checks those assignments again for every upload and sync. A company member who can access both workspaces can switch inside the app. Construction-only users open directly in Field.

## Run on a device

```bash
cd apps/mobile
npm install
EXPO_PUBLIC_API_URL=https://app.usepropbrew.com npm run start
```

Scan the Expo QR code with a compatible development client, or run `npm run ios` / `npm run android` on a configured development machine. Native camera, photo library, SQLite and precise foreground location permissions are required. The API URL is public configuration; never put provider secrets in `EXPO_PUBLIC_*` variables.

## Construction field workflow

1. A company administrator assigns a construction role, project and task in Team & access and maps the site's coordinates in Project Setup.
2. The member signs in, including an authenticator or recovery code if the account has two-factor authentication.
3. **Projects** shows only assigned projects. **Tasks** saves progress and photos. **Check in** captures a fresh precise location fix for the selected project. **Outbox** shows pending and rejected captures.
4. Captures are saved in a local SQLite queue before any network attempt. Photos are copied to the app's private document directory. The app replays the same capture ID on retry, uploads photos first, and deletes the local copy only after the server acknowledges the capture. It retries when connectivity returns or the app resumes. Server conflicts remain visible for review.
5. A previously authorised construction workspace can be viewed offline while the same local sign-in remains available. Sign-out warns about pending captures and clears local construction records. The queue is company/user scoped; it never displays another account's captures.

Location check-in is a **device-reported** proximity check against a configured site, subject to server accuracy, radius and age limits. It is not tamper-proof proof of physical presence. Photos and task updates are only confirmed after server acknowledgement. No native app-store binary is produced by this repository alone; that requires signing and release builds on iOS and Android.
