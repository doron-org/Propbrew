# Release-scan readiness — 10 November 2026

**Tracker item:** `release-scans` — accessibility, load, security and dependency thresholds

**Status:** **In progress; not release sign-off**

**Implementation under test:** `736876d57a015967fbb95b9d1adad91ae7ad92ec`

**Base:** `main` @ `a44fcf27b1d14d6c5f9be2feb38129da6320fffe`

This record separates measured local results from the remaining staging and launch gates. The implementation adds repeatable production accessibility checks and a real, bounded health-request smoke; it does not establish production capacity, complete the security-scan requirements, or approve deployment. No merge or deployment is part of this evidence.

## 1. Gate disposition

The requirements come from `docs/Propbrew. MASTER_PRD.md`, §11 “Release and operations” and §13 “Launch acceptance checklist”.

| Gate | Evidence-backed disposition |
|---|---|
| TypeScript, lint and regression tests | **Passed locally** on the implementation content; independent CI reproduction is still required. |
| PostgreSQL persistence and tenant isolation | **Passed locally:** disposable PostgreSQL integration plus an explicit isolation run; CI reproduction is still required. |
| Production dependency audit | **Passed:** zero production vulnerabilities reported by npm at the recorded run. |
| Axe for primary shells and critical flows | **Eight local production surfaces passed with zero automatically detected violations.** This is not WCAG certification; indeterminate/manual-review items and uncovered flows remain. CI reproduction is required. |
| Staging API-health load | **Not accepted.** The local production smoke passed, but both bounded public concurrent runs failed. No staging acceptance result exists. |
| Staging sync, payment-webhook, reconciliation and queue load | **Outstanding.** The health-only harness deliberately cannot target or certify these workflows. |
| Security/dependency/container scans | **Open except for the production npm audit.** No passing code, secret or container scan was observed. |
| Production configuration | **Unverified.** A sanitized local contract check found 0 of 14 required settings present; this says nothing about the actual Railway variable state. |
| Launch acceptance | **Outstanding.** Required operational, security, legal, DPO, client and other sign-offs are not inferred from tests. |

## 2. Implementation in the tested commit

- Adds `@axe-core/playwright` 4.14.0 and WCAG 2.1 A/AA scans for the workspace chooser, four primary workspace shells, the Estate Add property dialog, and company sign-in/sign-up.
- Runs the two axe groups against production bundles in CI. The ordinary development smoke excludes the dedicated production axe spec to avoid a duplicate cold-compilation run.
- Fixes the detected accessible-name, contrast, duplicate-ID and health-meter semantics findings, with corresponding component and browser assertions.
- Replaces the former health-load no-op with real native-fetch `GET /api/v1/health` requests. It requires an explicit origin, target and confirmation; rejects credentials and insecure remote URLs; forbids redirects; and caps the run at 20 workers, 10 seconds, 200 requests and a 2-second request timeout.
- Records statuses, request errors, invalid payloads, throughput and mean/p50/p95/p99/max latency. Its unit test verifies nine actual loopback requests and rejects missing-target and over-cap configurations without contacting production.
- Applies ordinary `npm audit fix --ignore-scripts` updates without `--force`; no unreviewed major-version override was introduced.

## 3. Local verification record

All commands ran from the repository root on 10 November 2026. The direct full-suite and disposable-PostgreSQL commands used **Node 26.0.0**; npm was **11.12.1**. The application build used **Next.js 16.4.3 (webpack)** and Vitest reported **4.1.12**. CI is configured for **Node 22**, so local success is not represented as a CI result.

Raw outputs are under the ignored local directory `.propbrew-local/release-scans/`. They are not committed evidence artifacts and must be reproduced independently by CI or a reviewer.

### Static checks and regressions

```bash
npx tsc --noEmit && npx eslint src tests --max-warnings 0
```

Passed after quarantining pre-existing duplicate generated files from the ignored `.next/types` directory into `.propbrew-local/release-scans/next-duplicate-artifacts/`. No source or tracked configuration was changed for that cleanup.

```bash
PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /opt/homebrew/bin/node node_modules/vitest/vitest.mjs run \
  > .propbrew-local/release-scans/vitest-full-verified.log 2>&1
```

At **15:57:27 local time**: **236 files passed, 10 skipped; 4,275 tests passed, 75 skipped**, in **16.75 seconds**. The routine skips comprise 73 PostgreSQL tests run separately below, plus the two intentional OCR/BCF external-evidence tests.

```bash
LC_ALL=C LANG=C PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /opt/homebrew/bin/node scripts/test-workspace-postgres.mjs \
  > .propbrew-local/release-scans/postgres-integration-verified.log 2>&1
```

At **16:02:03 local time**: **8 files and 73 tests passed** against the runner's disposable loopback-only PostgreSQL cluster, in **7.74 seconds** of Vitest time. The cluster was removed by the runner.

```bash
npx vitest run tests/data/isolation.test.ts tests/authz \
  > .propbrew-local/release-scans/isolation-verified.log 2>&1
```

At **15:57:45 local time**: **21 files and 612 tests passed**, in **1.90 seconds**.

A final focused rerun at **16:16:07 local time** also passed **4 files and 24 tests**:

```bash
PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
  /opt/homebrew/bin/node node_modules/vitest/vitest.mjs run \
  tests/load/health-load.test.ts tests/ui/company-auth-ui.test.ts \
  tests/ui/sidebar-motion.test.ts tests/ui/workspace-menu.test.ts
```

### Production build and browser checks

The final isolated build used explicit non-production credentials only as empty values and an isolated in-memory/demo configuration:

```bash
LANG=C LC_ALL=C NEXT_TELEMETRY_DISABLED=1 \
NEXT_PUBLIC_DEV_IDENTITY=0 NEXT_PUBLIC_SITE_URL=http://127.0.0.1:3106 \
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY= PROPBREW_AUTH_MODE=clerk \
DATA_SOURCE=memory REEVE_ALLOW_DEMO_IDENTITIES=0 REEVE_ALLOW_IN_MEMORY_DATA=0 \
CLERK_SECRET_KEY= OPENAI_API_KEY= ANTHROPIC_API_KEY= BLOB_READ_WRITE_TOKEN= \
npm run build > .propbrew-local/release-scans/local-release-build-verified.txt 2>&1
```

It succeeded; webpack compilation took **16.8 seconds** and TypeScript took **3.9 seconds**. This is a build result, not a deployed-environment configuration check.

The ignored local orchestration script `run-local-production.mjs` started a loopback production server with runtime-only isolated demo identities, waited for readiness, ran the health, axe and browser-smoke commands, and stopped the server in `finally`:

```bash
PATH=/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin \
RELEASE_NODE=/opt/homebrew/bin/node \
  /opt/homebrew/bin/node .propbrew-local/release-scans/run-local-production.mjs
```

The child commands were:

```bash
# Local health, with the managed loopback server running.
PROPBREW_LOAD_TARGET=loopback PROPBREW_LOAD_CONFIRM=local-health-only \
PROPBREW_LOAD_BASE_URL=http://127.0.0.1:3106 node scripts/health-load.mjs

# Production shell/dialog axe, against the already managed server.
PW_NO_SERVER=1 PW_PORT=3106 \
  node node_modules/@playwright/test/cli.js test \
  --config playwright.production-a11y.config.ts --reporter=json

# Production browser smoke, against the same managed server.
PW_NO_SERVER=1 PW_PORT=3106 \
  node node_modules/@playwright/test/cli.js test \
  --config playwright.config.ts --reporter=json
```

The production browser smoke started at **2026-11-10T14:57:18.193Z** and passed **16/16**, with no skips, retries or unexpected results. In an independent clean checkout, `npm run test:a11y` can start its own production server after the isolated build; `PW_NO_SERVER=1` is only for an already managed server.

The company-account production run used its disposable PostgreSQL cluster and application copy:

```bash
CI=1 npm run test:a11y:company \
  > .propbrew-local/release-scans/axe-company-production.txt 2>&1
```

It passed **2/2**. This runner now pins `LANG=C`/`LC_ALL=C`, uses `NODE_ENV=production` for production runs, and prints both PostgreSQL and Next logs on failure. One earlier company-build attempt encountered a transient Google-font download failure; the final recorded run passed and is the result reported here.

## 4. Accessibility results and limits

The shell/dialog run started at **2026-11-10T14:57:10.543Z**, used **axe-core 4.14.0**, and finished **6/6** with no failures. All scans used the `wcag2a`, `wcag2aa`, `wcag21a` and `wcag21aa` rule tags.

| Surface | Result | Indeterminate/manual-review evidence |
|---|---|---|
| Workspace chooser | 0 violations | None reported |
| Estate shell | 0 violations | Account-menu label/content-name check |
| Facility shell | 0 violations | Account-menu check; two health-ring contrast nodes where axe could not infer an image background |
| Shortlet shell | 0 violations | Account-menu label/content-name check |
| Construction shell | 0 violations | Account-menu check; two chart-ring contrast nodes where axe could not infer an image background |
| Estate Add property dialog | 0 violations | None reported |
| Company sign-in | 0 violations, asserted by the passing test | No manual accessibility certification implied |
| Company sign-up | 0 violations, asserted by the passing test | No manual accessibility certification implied |

Raw shell evidence: `axe-production-verified.json`; decoded evidence: `axe-scan-evidence-verified.json`. Company output: `axe-company-production.txt`.

“Incomplete” means axe could not determine a result; it is not counted as a violation and must not be relabelled as a manual pass. Keyboard operation, screen-reader review, the four account-menu checks, the chart/ring contrast, and critical flows beyond this initial surface set still require appropriate review. No claim of full WCAG conformance is made.

## 5. Health measurements — local pass, public failure

The harness uses status `0` internally when fetch produced no HTTP response; it is not an HTTP status returned by the server. These are read-only health measurements, not sync/payment/reconciliation/queue tests or a production-capacity certification.

### Local production bundle — passed

Started **2026-11-10T14:57:09.941Z**, with 20 workers, a 10-second run cap, 200-request cap and 2-second per-request timeout:

- **200/200 HTTP 200**, zero request errors and zero invalid payloads.
- Wall time **262.730 ms**; recorded throughput **761.239 requests/second**.
- Mean **22.778 ms**; p50 **7.564 ms**; p95 **143.180 ms**; p99 **189.299 ms**; max **209.287 ms**.

Raw output: `health-load-local-production.json`.

### Public concurrent health — failed twice

Both runs used the same hard limits and the explicitly confirmed command target:

```bash
PROPBREW_LOAD_TARGET=production PROPBREW_LOAD_CONFIRM=production-health-only \
PROPBREW_LOAD_BASE_URL=https://app.usepropbrew.com npm run test:load:health
```

| Started (UTC) | Requests | HTTP responses | Request errors | Wall time | Mean | p50 | p95 | p99 | Max |
|---|---:|---:|---|---:|---:|---:|---:|---:|---:|
| 2026-11-10T14:33:37.959Z | 100 | 0 | 100 `TimeoutError` | 10,045.457 ms | 2,002.559 ms | 2,001.297 ms | 2,009.687 ms | 2,011.145 ms | 2,011.279 ms |
| 2026-11-10T14:40:54.398Z | 100 | 0 | 100 `TimeoutError` | 10,063.667 ms | 2,000.590 ms | 2,000.429 ms | 2,001.942 ms | 2,002.279 ms | 2,003.270 ms |

Raw outputs: `health-load-production.json` and `health-load-production-retry.json`.

Between those runs, a separate single-request check succeeded:

```bash
curl --max-time 15 --silent --show-error \
  --write-out '\nHTTP %{http_code}; total %{time_total}s\n' \
  https://app.usepropbrew.com/api/v1/health
```

At **2026-11-10T14:38:38.585Z**, it returned the expected health payload and **HTTP 200 in 1.499299 seconds**. This establishes only that an individual request succeeded; it does not explain or clear the concurrent failures. The cause is unresolved: do not infer either a general outage or a capacity pass, and do not hide the result by increasing the timeout.

## 6. Dependency and security evidence

### npm dependencies

```bash
npm audit fix --ignore-scripts
npm audit --omit=dev --audit-level=high
npm audit --json
```

- Production-only audit: **0 vulnerabilities**.
- Full audit before and after the ordinary fix: **7 moderate, 0 high, 0 critical**. The advisory count did not fall to zero.
- The remaining chain is development-only: `typescript-eslint@8.72.2` / `@typescript-eslint/typescript-estree@8.72.2` → `minimatch@10.2.6`, advisory **GHSA-g3hv-75wg-m249**.
- At the recorded registry check, the latest TypeScript ESLint was 8.72.2 and declared `minimatch: ^10.2.2`; the patched minimatch line is **11.0.1 or later**. No `--force` or breaking override was used to disguise this as resolved.

Raw outputs: `npm-audit-full.json`, `npm-audit-full-after-fix.json`, and `npm-audit-production-verified.txt`.

### Code, secret and container coverage — not closed

At the repository observations recorded on 10 November:

- Dependabot security updates and secret scanning were disabled. API queries consequently returned disabled/403 or disabled/404 responses, not clean-alert evidence.
- The code-scanning alerts query returned **404 “no analysis found”**. That is not a CodeQL pass.
- No CodeQL, Trivy, Gitleaks, Semgrep or dependency-review workflow was found under `.github`.
- No `Dockerfile`, `Containerfile`, `railway.json`, `railway.toml` or `railpack.json` definition was found. Therefore no container/build-image scan is claimed.

Raw settings/query outputs: `github-security-settings.json`, `dependabot-error.txt`, `secret-scanning-error.txt`, and `code-scanning-error.txt`. Repository security settings were not changed.

### Deployed configuration is not the local empty environment

```bash
npm run check:production-env
```

The sanitized local result reported **14 required, 0 present**. It was intentionally run without production credentials and proves only that this local shell did not satisfy the production contract. It is **not evidence that Railway is missing those variables**. Deployed configuration remains unverified until an authorized Railway check validates presence and contract without exposing values.

Raw output: `production-env-verified.txt`.

## 7. Required work before `release-scans` can close

1. Reproduce the implementation checks in CI, including both production axe groups, and review any CI-specific failure rather than treating this local record as a substitute.
2. Diagnose the public concurrent-health timeouts with authorized Railway/service and edge observations. Repeat only a bounded, explicitly approved health check after diagnosis; preserve failures and avoid weakening thresholds to obtain a pass.
3. Define and run authorized **staging** load protocols for health, offline sync, payment webhooks, reconciliation and queue processing. Record synthetic-data scope, request volumes, latency/error thresholds, saturation, retries/idempotency and reconciliation correctness. The health-only script does not cover them.
4. Complete manual accessibility review for the indeterminate items and critical user flows not covered by these eight surfaces. Retain axe as an automated regression gate, not a conformance certificate.
5. Agree and implement code/static, secret and dependency-review scanning. Determine the actual Railway build artifact and an appropriate container/image scan, or record a reviewer-approved alternative if no container exists. Do not enable repository security settings silently.
6. Reassess the seven moderate development advisories when a compatible upstream fix exists, or document a separate reviewed remediation/risk decision. Keep the production audit at zero high/critical findings.
7. Verify deployed configuration and operational readiness without exposing secrets, then record the PRD-required UAT, observability, backup/restore, rollback and accountable human launch sign-offs.

**Current conclusion:** useful local release evidence is implemented and recorded, but `release-scans` remains **In progress**. This branch has not established merge approval, deployment approval, or launch readiness.
