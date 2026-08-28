# Apple Sign-In Revocation — Secret Preflight (Read-Only)

**Date:** 2026-08-28  
**Scope:** Audit current `revokeAppleSignInTokens` implementation only — no code changes, no deploy, no secrets printed.

---

## Implementation map

| Layer | File | Role |
|-------|------|------|
| Callable entry | `backend/src/index.ts` → `revokeAppleSignInTokens` | Auth-gated HTTPS callable; accepts `{ authorizationCode }`; rate-limited (`accountDeletion`) |
| Revocation | `backend/src/appleTokenRevocation.ts` | Builds revoke request; calls `https://appleid.apple.com/auth/revoke` |
| Client secret JWT | `backend/src/appleClientSecret.ts` | Reads env; builds ES256 JWT; normalizes private key newlines |
| Client trigger | `src/services/appleSignInRevocationService.ts` | On account deletion for Apple-linked users; calls callable |
| Authorization code source | `src/services/appleAuthService.ts` | Native `expo-apple-authentication` `signInAsync()` → `appleCredential.authorizationCode` |
| iOS app identity | `app.config.js` / `app.json` | `bundleIdentifier: com.ethemsincar.logisticore`, `usesAppleSignIn: true` |
| Entitlement | `ios/LogistiCore/LogistiCore.entitlements` | `com.apple.developer.applesignin` → `Default` |

**No Services ID** appears anywhere in repo config or auth flow.

---

## Variable consumption (exact)

### `APPLE_SIGNIN_TEAM_ID`

| Aspect | Detail |
|--------|--------|
| **Read** | `process.env.APPLE_SIGNIN_TEAM_ID?.trim()` in `readAppleSignInServerConfigFromEnv()` |
| **Used as** | JWT payload claim **`iss`** (issuer) in `createAppleClientSecret()` |
| **Also** | Not sent directly in revoke POST body |
| **Type** | Apple Developer **10-character Team ID** (e.g. `AB12CDE34F`) |
| **In repo?** | **No** — not stored in project files |
| **Source** | [Apple Developer](https://developer.apple.com/account) → **Membership** → **Team ID** |

---

### `APPLE_SIGNIN_CLIENT_ID`

| Aspect | Detail |
|--------|--------|
| **Read** | `process.env.APPLE_SIGNIN_CLIENT_ID?.trim()` |
| **Used as** | (1) JWT payload claim **`sub`** in client-secret JWT; (2) **`client_id`** form field in revoke POST (`URLSearchParams`) |
| **Must match** | The client that issued the **authorization code** being revoked |

#### CLIENT_ID type determination (not guessed)

| Option | Applies to this app? | Evidence |
|--------|----------------------|----------|
| **A) iOS bundle ID / App ID** | **Yes — expected** | Native-only flow via `expo-apple-authentication` `signInAsync()` on iOS; no web redirect; no Services ID in repo; bundle ID is the only Apple client identifier configured |
| **B) Services ID** | **No** | No Services ID string, no web OAuth redirect URLs, no server-side web Apple login in codebase |
| **C) Other** | **No** | Implementation only references `clientId` as opaque string for Apple `client_id` + JWT `sub` |

**Identifier string present in repo (not invented):**

```
com.ethemsincar.logisticore
```

Found in: `app.json` (`ios.bundleIdentifier`), `app.config.js`, `src/config/firebaseRuntimeContract.ts` (`EXPECTED_IOS_BUNDLE_ID`), `GoogleService-Info.plist` (`BUNDLE_ID`), Xcode `PRODUCT_BUNDLE_IDENTIFIER`.

**Operational rule:** Set `APPLE_SIGNIN_CLIENT_ID` to the **same identifier Apple used when issuing authorization codes from the native iOS app** — for this implementation that is the **App ID / bundle ID** above, unless your Apple Developer portal uses a different primary App ID for Sign in with Apple (verify in portal; repo does not contain Team ID or portal state).

---

### `APPLE_SIGNIN_KEY_ID`

| Aspect | Detail |
|--------|--------|
| **Read** | `process.env.APPLE_SIGNIN_KEY_ID?.trim()` |
| **Used as** | JWT header **`kid`** (key id) in `createAppleClientSecret()` |
| **Type** | Apple **Sign in with Apple** key ID from Developer portal (10 characters, shown when key is created) |
| **In repo?** | **No** |
| **Source** | Apple Developer → **Certificates, Identifiers & Profiles** → **Keys** → key with **Sign in with Apple** enabled → **Key ID** |

Must correspond to the `.p8` file used for `APPLE_SIGNIN_PRIVATE_KEY`.

---

### `APPLE_SIGNIN_PRIVATE_KEY`

| Aspect | Detail |
|--------|--------|
| **Read** | `process.env.APPLE_SIGNIN_PRIVATE_KEY?.trim()` |
| **Normalization** | `privateKeyRaw.replace(/\\n/g, '\n')` — literal `\n` escape sequences become real newlines |
| **Used as** | `createSign('SHA256').sign(config.privateKey)` — Node.js crypto ES256 signing input for client-secret JWT |
| **In repo?** | **No** (correct) |

#### Expected format

| Format | Supported? |
|--------|------------|
| **PEM `.p8` private key** (`-----BEGIN PRIVATE KEY-----` … `-----END PRIVATE KEY-----`) | **Yes — required** |
| **Single-line env with `\n` escapes** | **Yes** — code explicitly normalizes `\\n` → newline |
| **Multiline PEM in env / console** | **Yes** — if newlines are real characters after trim |
| **Base64-only (no PEM headers)** | **No** — not handled by code |
| **File path** | **No** — not handled; must be key **content** in env |

**Source:** Download **once** when creating the Sign in with Apple key in Apple Developer (`.p8` file). Apple does not allow re-download.

---

## Revoke request shape (runtime)

`revokeAppleAuthorizationCode()` POSTs to `https://appleid.apple.com/auth/revoke`:

| Field | Value source |
|-------|----------------|
| `client_id` | `APPLE_SIGNIN_CLIENT_ID` |
| `client_secret` | ES256 JWT from `createAppleClientSecret()` |
| `token` | Client-supplied `authorizationCode` from callable |
| `token_type_hint` | Fixed: `authorization_code` |

If any of the four env vars is missing/empty → `readAppleSignInServerConfigFromEnv()` returns `null` → revoke returns `{ ok: false, reason: 'not-configured' }` (callable still deploys; revocation fails at runtime).

JWT client-secret claims (Apple standard):

```text
header: { alg: "ES256", kid: <APPLE_SIGNIN_KEY_ID> }
payload: {
  iss: <APPLE_SIGNIN_TEAM_ID>,
  sub: <APPLE_SIGNIN_CLIENT_ID>,
  aud: "https://appleid.apple.com",
  iat: <now>,
  exp: <now + 150 days>   // implementation uses 150 days
}
```

---

## Firebase secret binding model (current code)

| Mechanism | Used? |
|-----------|-------|
| `defineSecret()` / `firebase-functions/params` | **No** |
| `secrets: [...]` on `onCall()` options | **No** |
| `dotenv` import in `backend/src/index.ts` | **No** |
| `firebase.json` `functions.env` | **No** |
| **`process.env` at request time** | **Yes** — sole binding |

`revokeAppleSignInTokens` uses the same `VEHICLE_MARKETPLACE_FUNCTION_OPTIONS` as other callables (`region: us-central1`, etc.) with **no secret bindings**.

### Implications

1. **`firebase functions:secrets:set` alone does not inject values** into this function unless code is later updated to declare `secrets: [...]` (or `defineSecret` + bind).
2. **Works today without code changes** if env vars are present in the **deployed function runtime environment** (see CLI options below).
3. **Preferred Secret Manager pattern** (bind secrets per-function) is **not implemented** — optional future code change, not required for plain env-var setup.

---

## Safe configuration commands (DO NOT run secrets with real values in shell history carelessly)

### Option A — Project-scoped `.env` file (Firebase Functions v2 deploy loading)

Create a **gitignored** file (repo already ignores `.env.*`):

**Path:** `backend/.env.logisticore-53ab4`

```dotenv
APPLE_SIGNIN_TEAM_ID=<your-10-char-team-id>
APPLE_SIGNIN_CLIENT_ID=com.ethemsincar.logisticore
APPLE_SIGNIN_KEY_ID=<your-key-id>
APPLE_SIGNIN_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n<line1>\n<line2>\n-----END PRIVATE KEY-----"
```

Then deploy (when ready — **not part of this preflight**):

```powershell
$env:FUNCTIONS_DISCOVERY_TIMEOUT="60"
firebase deploy --only functions:revokeAppleSignInTokens --project logisticore-53ab4
```

Firebase loads `backend/.env` and `backend/.env.<projectId>` into Gen2 function environment at deploy time.

---

### Option B — Google Cloud Secret Manager + env reference (no code change if using Cloud Console)

Store secret in Secret Manager, then attach as **environment variable** on the Cloud Run service backing `revokeAppleSignInTokens` (Firebase Console → Functions → function → configuration, or `gcloud run services update`).

Secret **names** to create (values from Apple portal only):

- `APPLE_SIGNIN_TEAM_ID`
- `APPLE_SIGNIN_CLIENT_ID`
- `APPLE_SIGNIN_KEY_ID`
- `APPLE_SIGNIN_PRIVATE_KEY`

Example **Secret Manager create** (replace placeholders; run locally when ready):

```bash
# Create secrets (one-time) — paste value at prompt; do not commit
gcloud secrets create APPLE_SIGNIN_TEAM_ID --project=logisticore-53ab4 --replication-policy=automatic
gcloud secrets create APPLE_SIGNIN_CLIENT_ID --project=logisticore-53ab4 --replication-policy=automatic
gcloud secrets create APPLE_SIGNIN_KEY_ID --project=logisticore-53ab4 --replication-policy=automatic
gcloud secrets create APPLE_SIGNIN_PRIVATE_KEY --project=logisticore-53ab4 --replication-policy=automatic

# Add versions (interactive — do not log output)
echo -n "<TEAM_ID>" | gcloud secrets versions add APPLE_SIGNIN_TEAM_ID --data-file=- --project=logisticore-53ab4
echo -n "com.ethemsincar.logisticore" | gcloud secrets versions add APPLE_SIGNIN_CLIENT_ID --data-file=- --project=logisticore-53ab4
echo -n "<KEY_ID>" | gcloud secrets versions add APPLE_SIGNIN_KEY_ID --data-file=- --project=logisticore-53ab4
# For private key, use a file path to .p8 instead of echoing to terminal:
gcloud secrets versions add APPLE_SIGNIN_PRIVATE_KEY --data-file=./AuthKey_XXXXXXXXXX.p8 --project=logisticore-53ab4
```

Then map secrets → env vars on the function’s Cloud Run service (exact service name appears after first deploy). Grant the function service account `roles/secretmanager.secretAccessor` on each secret.

---

### Option C — Firebase `functions:secrets:set` (requires code change first)

**Not active in current code.** Would need:

```typescript
import { defineSecret } from 'firebase-functions/params';
const applePrivateKey = defineSecret('APPLE_SIGNIN_PRIVATE_KEY');
// ... same for other three ...
export const revokeAppleSignInTokens = onCall({
  ...VEHICLE_MARKETPLACE_FUNCTION_OPTIONS,
  secrets: [applePrivateKey, /* ... */],
}, async (request) => { ... });
```

Only after that:

```bash
firebase functions:secrets:set APPLE_SIGNIN_PRIVATE_KEY --project logisticore-53ab4
firebase functions:secrets:set APPLE_SIGNIN_TEAM_ID --project logisticore-53ab4
firebase functions:secrets:set APPLE_SIGNIN_CLIENT_ID --project logisticore-53ab4
firebase functions:secrets:set APPLE_SIGNIN_KEY_ID --project logisticore-53ab4
```

**This preflight: no code changes requested — use Option A or B for first deploy.**

---

## Apple Developer portal checklist (values to obtain)

| Item | Where | Maps to env var |
|------|--------|-----------------|
| Team ID | Membership details | `APPLE_SIGNIN_TEAM_ID` |
| App ID / bundle ID | Identifiers → App IDs → `com.ethemsincar.logisticore` → Sign in with Apple enabled | `APPLE_SIGNIN_CLIENT_ID` (native app) |
| Sign in with Apple key | Keys → create → enable Sign in with Apple → download `.p8` once | `APPLE_SIGNIN_KEY_ID` + `APPLE_SIGNIN_PRIVATE_KEY` |

**Do not create a new key** if an existing Sign in with Apple key is already in use for this app — use the same key ID and `.p8` you already have (this audit does not know portal state).

---

## Are code changes needed before secret setup?

| Goal | Code change required? |
|------|------------------------|
| Deploy `revokeAppleSignInTokens` | **No** |
| Inject secrets via `backend/.env.logisticore-53ab4` + deploy | **No** |
| Inject via Cloud Console / Cloud Run env vars | **No** |
| Use `firebase functions:secrets:set` with automatic injection | **Yes** — add `defineSecret` + `secrets: []` on callable |
| Revocation succeeds at runtime | **No code change** — only correct env values + deployed function |

---

## Preflight env status (this machine / repo)

| Variable | Present in repo/shell? |
|----------|-------------------------|
| `APPLE_SIGNIN_TEAM_ID` | **missing** |
| `APPLE_SIGNIN_CLIENT_ID` | **missing** (bundle ID `com.ethemsincar.logisticore` is documented above as expected value) |
| `APPLE_SIGNIN_KEY_ID` | **missing** |
| `APPLE_SIGNIN_PRIVATE_KEY` | **missing** |

Values must be supplied from Apple Developer portal before deploy; implementation expectations are fully specified.

---

## Final status

### **`APPLE_SECRET_SETUP_READY`**

You can configure secrets and deploy **without code changes** using Option A or B. Obtain Team ID, Key ID, and `.p8` from Apple Developer; set `APPLE_SIGNIN_CLIENT_ID` to the native app bundle ID `com.ethemsincar.logisticore` unless portal configuration differs.

**Not blocked** on implementation ambiguity. **Still blocked on deploy** until the four values are configured in the function runtime environment (see prior deploy report).
