# Apple Sign-In Secret Manager Binding — Ready

**Date:** 2026-08-28  
**Status:** `APPLE_SECRET_BINDING_READY`

---

## Code changes (implemented)

| File | Change |
|------|--------|
| `backend/src/appleSignInSecrets.ts` | **New** — `defineSecret()` for all four vars; `readAppleSignInSecretValuesFromBinding()` |
| `backend/src/appleClientSecret.ts` | `resolveAppleSignInServerConfig()` — bound values first, `process.env` fallback for emulator/local |
| `backend/src/appleTokenRevocation.ts` | Accepts config input from bound secrets |
| `backend/src/index.ts` | `revokeAppleSignInTokens` only: `secrets: [...APPLE_SIGNIN_SECRETS]` |

**Isolation:** No other callable declares `APPLE_SIGNIN_SECRETS`. Other functions do not receive these secrets.

**Production path:** Callable reads `secret.value()` via `readAppleSignInSecretValuesFromBinding()` and passes to `revokeAppleAuthorizationCode()`.

**Local/emulator fallback:** `resolveAppleSignInServerConfig()` falls back to `process.env.APPLE_SIGNIN_*` when secret fields are empty (e.g. unit tests without bound secrets).

**Private key:** `normalizeApplePrivateKey()` supports raw PEM `.p8` and `\n`-escaped single-line strings. Private key is never logged.

---

## Validation

| Command | Result |
|---------|--------|
| `npm --prefix backend run build` | PASS |
| `npm run backend:verify` | PASS |
| `npx tsc --noEmit` | PASS |
| `git diff --check` | PASS |

---

## Manual steps (run yourself — not executed by agent)

### Prerequisites

```powershell
cd C:\Users\ahmet\LogistiCore
firebase login
firebase use logisticore-53ab4
```

Set a variable for your `.p8` path (adjust filename):

```powershell
$AppleP8Path = "C:\path\to\AuthKey_XXXXXXXXXX.p8"
```

---

### 1. Create secrets in Firebase Secret Manager

**Team ID** — interactive prompt (value not echoed in command line):

```powershell
firebase functions:secrets:set APPLE_SIGNIN_TEAM_ID --project logisticore-53ab4
```

When prompted, paste your 10-character Apple Team ID and press Enter.

---

**Client ID** — non-secret bundle ID; safe to pass via stdin without storing in history if you use a variable:

```powershell
$AppleClientId = "com.ethemsincar.logisticore"
$AppleClientId | firebase functions:secrets:set APPLE_SIGNIN_CLIENT_ID --project logisticore-53ab4 --data-file -
```

---

**Key ID** — interactive prompt:

```powershell
firebase functions:secrets:set APPLE_SIGNIN_KEY_ID --project logisticore-53ab4
```

When prompted, paste your Apple Sign in with Apple key ID (10 characters).

---

**Private key** — read directly from `.p8` file (preferred; avoids pasting PEM into shell history):

```powershell
Get-Content -Raw -Path $AppleP8Path | firebase functions:secrets:set APPLE_SIGNIN_PRIVATE_KEY --project logisticore-53ab4 --data-file -
```

Alternative (file path directly, if your Firebase CLI version supports it):

```powershell
firebase functions:secrets:set APPLE_SIGNIN_PRIVATE_KEY --project logisticore-53ab4 --data-file $AppleP8Path
```

The secret value must be the **raw PEM contents** of the `.p8` file (`-----BEGIN PRIVATE KEY-----` through `-----END PRIVATE KEY-----`), including newlines.

---

### 2. Verify secrets exist (names only)

```powershell
firebase functions:secrets:access APPLE_SIGNIN_TEAM_ID --project logisticore-53ab4
```

Repeat for each name only if you need to confirm deployment wiring — **do not share command output** (it contains secret values).

Safer check:

```powershell
gcloud secrets list --project=logisticore-53ab4 --filter="name:APPLE_SIGNIN"
```

---

### 3. Deploy (after secrets are set)

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "60"
firebase deploy --only functions:revokeAppleSignInTokens --project logisticore-53ab4
```

Expect: `Deploy complete!`

First deploy of a secret-bound function may prompt to grant the Cloud Functions service account access to each secret — approve when prompted.

---

### 4. Post-deploy smoke (optional)

Confirm function is listed:

```powershell
firebase functions:list --project logisticore-53ab4
```

Look for `revokeAppleSignInTokens` in `us-central1`.

Full Apple revocation end-to-end requires a linked Apple account deletion on device; server returns `not-configured` until secrets are set and deployed.

---

## Expected secret values (types only — do not commit)

| Secret name | Expected content |
|-------------|------------------|
| `APPLE_SIGNIN_TEAM_ID` | Apple Developer Team ID (10 chars) |
| `APPLE_SIGNIN_CLIENT_ID` | `com.ethemsincar.logisticore` (native iOS bundle ID) |
| `APPLE_SIGNIN_KEY_ID` | Sign in with Apple key ID from `.p8` filename |
| `APPLE_SIGNIN_PRIVATE_KEY` | Full `.p8` PEM file contents |

---

## Final status

### **`APPLE_SECRET_BINDING_READY`**

Code binds all four secrets exclusively to `revokeAppleSignInTokens`. Run the PowerShell commands above, then deploy.
