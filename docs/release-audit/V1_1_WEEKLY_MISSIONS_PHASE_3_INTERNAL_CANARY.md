# Weekly Missions Phase 3 — Controlled Backend Deploy + Internal Canary

Date: 2026-09-12  
Firebase project: `logisticore-53ab4`  
Region: `us-central1`

## Executive result

Backend Weekly Missions functions and Firestore rules were deployed. Server canary flag is **ON**. Client production/store flag remains **OFF**. Internal client profile is prepared **ON**.

Linked-account callable mutation canary (baseline via `getWeeklyMissions`, real delivery completion, claim payout) could **not** be completed from this workstation:

- Email/Password account creation is `OPERATION_NOT_ALLOWED` in production Auth
- `iam.serviceAccounts.signBlob` is denied for disposable custom tokens
- Direct callable HTTPS (`*.cloudfunctions.net` / `*.run.app`) is blocked by the local Cursor sandbox proxy (CONNECT 403)

Rotation seeding, immutability, rules write denials, fail-closed scheduler behavior, and production client-flag safety were verified.

Final status: **BLOCKED** for Phase 4 (store/client production enablement).  
Deployed canary backend remains usable for a manual internal-build pass.

## Server flag mechanism

Gitignored file loaded at Firebase deploy time:

`backend/.env.logisticore-53ab4`

```text
SEASON_CLOSE_SNAPSHOT_ENABLED=false
SEASON_REWARDS_ENABLED=false
WEEKLY_MISSIONS_BACKEND_ENABLED=true
```

Deploy log confirmed: `Loaded environment variables from .env.logisticore-53ab4`.

Cloud Functions v2 service config for `getWeeklyMissions` (and the other three Weekly functions) shows:

`WEEKLY_MISSIONS_BACKEND_ENABLED=true`

## Client flags

| Profile | `EXPO_PUBLIC_ENABLE_BACKEND_WEEKLY_MISSIONS` |
|---|---|
| `.env.production` / store | `false` |
| `.env.internal` | `true` |
| `.env.example` | `false` |

Store production policy still forbids enabling the client flag for store builds. No store archive was created.

## Deployed resources

```bash
firebase deploy --only \
  functions:recordCanonicalDeliveryCompletion,\
  functions:getWeeklyMissions,\
  functions:claimWeeklyMissionReward,\
  functions:seedWeeklyMissionRotation,\
  firestore:rules \
  --project logisticore-53ab4
```

No unrelated functions were selected. Shared helpers ship inside the selected function packages only (no extra function names required).

## Rotation canary (scheduler path)

Triggered:

`firebase-schedule-seedWeeklyMissionRotation-us-central1:run`

Resulting doc `weeklyMissionRotations/2026-W37`:

| Field | Value |
|---|---|
| weekKey | `2026-W37` |
| locked | `true` |
| missionIds | `wm_deliveries_5`, `wm_deliveries_10`, `wm_deliveries_20` |
| difficulties | easy / medium / hard |
| rewards | 2000 + 4000 + 6500 = **12500** |
| fingerprint | `90853a501735b4cfe6a954477556895686aa804d1689bb3dfe71e8c8edd8828d` |

Second scheduler run: fingerprint **byte-equivalent**; `createTime` / `updateTime` / `createdAt` unchanged.

## Guest / rules

- Anonymous Auth signup works
- Guest baseline doc: **NOT_FOUND**
- Guest canonical completions list: empty
- Client Firestore PATCH denials (Firebase ID token): **403** for rotations, templates, claims, baselines, canonicalDeliveryCompletions
- Unauthenticated PATCH to rotation: **403**

## Fail-closed

1. Set `WEEKLY_MISSIONS_BACKEND_ENABLED=false`, redeployed the four Weekly functions
2. Confirmed service env `false`
3. Ran scheduler again — rotation fingerprint unchanged
4. Restored `WEEKLY_MISSIONS_BACKEND_ENABLED=true` and redeployed the four functions
5. Confirmed service env `true` again

Canary data (current week rotation) was not deleted.

## Blocked linked canary checklist

| Step | Status |
|---|---|
| Linked `getWeeklyMissions` + baseline | BLOCKED (no disposable linked identity) |
| Real in-game delivery → canonical completion | PENDING_INTERNAL_BUILD_MANUAL |
| Duplicate deliveryId safety | BLOCKED (depends on linked path) |
| Claim payout | WAITING_FOR_NATURAL_COMPLETION (+ linked auth) |
| Guest callable get/claim/record | BLOCKED (callable HTTPS from workstation) |

Runner prepared for when credentials exist:

`backend/scripts/productionWeeklyMissionsCanary.ts --confirm-production`

## Emulator

`WRITTEN_BUT_NOT_EXECUTED_NO_JAVA`

## Production safety

- Client store/production Weekly backend UI flag: **false**
- Server Weekly backend flag (canary): **true**
- No app/store build shipped
- Legacy Weekly code not retired
- Missions / Achievements unchanged

## Next step for Phase 4 readiness

1. `firebase login --reauth` (or CI token) if CLI token stale
2. Provision a disposable linked test account (or grant `signBlob` for canary SA)
3. Run internal build with `.env.internal` Weekly flag ON
4. Complete one real delivery → verify canonical doc + progress +1 + idempotent retry
5. After natural mission completion → claim canary
6. Only then consider Phase 4 (broader enablement / legacy retirement)
