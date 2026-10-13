# Synthetic demo seed

This directory contains synthetic fixtures only. Names, addresses, HNs and CID-like strings are deliberately marked as demo data. CID display fixtures do not pass the Thai citizen-ID checksum.

Demo roles:

- `admin` — aggregate administration only
- `cm` — clinical manager capabilities for workflow testing
- `cg` — one assigned patient and visit tasks only

The browser role selector is not authentication. It works only against `wrangler dev` on localhost with `DEMO_IMPERSONATION=true`; a deployed DEMO requires sign-in.

## Creating sign-in accounts for a deployed DEMO

1. **Password (GAS).** In the Apps Script editor add a temporary file containing, for example, `function seedCm() { return setDemoCredential('usr-demo-cm', 'cm.demo', '<at least 12 characters>'); }`, run it once, then delete the file. The function works only with `APP_MODE=DEMO`. It revokes the user's previous credential and any credential that held the same identifier (for example after renaming a `userId` in `Users`), and returns `elapsedMs` for one hash and `revokedCredentials`. Put such helpers in a separate editor file, never in `bundle.js`: every `clasp push` replaces the project's files. If a sign-in still fails, run `diagnoseDemoLogin('<identifier>', '<password>')` the same way; its `verdict` names the failing step. Set the `PASSWORD_ITERATIONS` Script Property (default 10000) so that `elapsedMs` stays below about 5 seconds; it applies to credentials created afterwards.
2. **TOTP (CM and ADMIN).** From the repository root run `MFA_ENCRYPTION_KEY_BASE64=<same value as the Worker secret> node scripts/seed-demo/enroll-totp.mjs usr-demo-cm cm.demo`. Run the printed `wrangler d1 execute` command from the repository root, then add the printed `otpauth://` URI to an authenticator app. Neither the secret nor the URI is stored anywhere else.

