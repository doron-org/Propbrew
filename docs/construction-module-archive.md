# Construction module archive

Construction is archived in the application as of 24 November 2026. The archive does not delete projects, documents, memberships, assignments, financial history, code, or migrations.

## Active experience

- Property Management and Shortlet remain visible in sign-in, demo entry, and the workspace chooser.
- A saved Construction company grant is shown as **Construction · archived** in company and Team & access views. Existing assignments remain stored.
- Direct Construction pages redirect to the workspace chooser with an archive notice. Construction and construction mobile API paths return 404 without invoking their handlers.
- The Expo app hides its Construction field surface by default. It retains any existing on-device capture until the user explicitly signs out; sign-out warns about unsynced captures.
- Construction data can still contribute to historical cross-module records. The archive does not alter shared finance data or database rows.

## Reopening

Set `NEXT_PUBLIC_ENABLE_CONSTRUCTION=true` for the application build and runtime, then redeploy. Remove the flag to archive it again. Reopening requires product and permission review before inviting new Construction users. The browser and company-account test runners explicitly enable Construction to preserve regression coverage while the public module is archived.

When reopening the native field app, also build it with `EXPO_PUBLIC_ENABLE_CONSTRUCTION=true`. Re-enable the server and native surfaces together so queued captures have a receiving endpoint.

## Scope

This is an application access archive, not a data-retention action. Do not run data deletion or migration rollback to archive the module.
