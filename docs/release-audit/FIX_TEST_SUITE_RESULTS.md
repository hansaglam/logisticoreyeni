# FIX Test Suite Results — Audit Red Tests Remediation

**Date:** 2026-08-06  
**Scope:** Six failing audit regression/smoke scripts + full active suite re-run  
**Status:** MITIGATED — **65 PASS / 0 FAIL / 1 SKIP** (headless suite)

---

## Summary

| Metric | Before | After |
|--------|--------|-------|
| Active test scripts | 66 | 66 |
| PASS | 56 | **65** |
| FAIL | 6 | **0** |
| SKIP (emulator-gated) | — | 1 |
| Product code changed | — | **No** (test + harness only) |

**Verification**

```text
npm run typecheck     → PASS
npm run verify        → PASS
expo export android   → PASS
expo export ios       → PASS
git diff --check      → PASS
```

AAB / APK / IPA / Archive **not produced**.

---

## Per-Test Remediation

### 1. `account-switch-flow-test.ts`

| Field | Detail |
|-------|--------|
| **Old failure** | Static assert `/Google Hesabından Çıkış Yap/` — UI now provider-neutral `Çıkış Yap` |
| **Classification** | Stale assertion (B-002 account switch already fixed in product) |
| **Change** | Provider-neutral labels; added `rollbackAccountSwitch` / `commitAccountSwitch` / `switchToLinkedProviderAccount` / Apple link wiring checks |
| **Product code** | No |
| **Test-only** | Yes |

---

### 2. `debug-contract-generation-test.ts`

| Field | Detail |
|-------|--------|
| **Old failure** | Section E expected `ankara-trabzon` / `adana-diyarbakir` uncalibrated + unreachable |
| **Classification** | Stale fixture — routes now calibrated in `mapRoadNetwork.ts` |
| **Change** | Assert calibrated segments, graph connectivity, L11 generation with finite distance + valid ETA; L3 locked trabzon; force mode still creates jobs |
| **Product code** | No |
| **Test-only** | Yes |

---

### 3. `phase3-smoke-test.ts`

| Field | Detail |
|-------|--------|
| **Old failure** | `MoreScreen` no longer lists `key: 'upgrades'` module tile |
| **Classification** | Stale navigation expectation |
| **Change** | Canonical entry via **Fleet → Geliştirmeleri Yönet → UpgradesScreen**; More deep-link `route === 'upgrades'` retained for pending upgrade flow |
| **Product code** | No |
| **Test-only** | Yes |

---

### 4. `time-progression-audit-test.ts`

| Field | Detail |
|-------|--------|
| **Old failure** | Expected 1-minute offline below minimum threshold (legacy 5-minute model) |
| **Classification** | Stale offline threshold |
| **Change** | Align with `MIN_OFFLINE_PROGRESS_MS === GAME_LOOP_TICK_MS`; sub-tick discarded; **1 minute applies progress** + simulation hours > 0; Date.now / ServerEconomyClock tests unchanged |
| **Product code** | No |
| **Test-only** | Yes |

---

### 5. `vehicle-marketplace-create-chain-test.ts`

| Field | Detail |
|-------|--------|
| **Old failure** | `/Google hesabınla/` auth copy; `/getFunctions(firebaseApp…/` stale service wiring |
| **Classification** | Stale provider-specific text + stale Firebase Functions init pattern |
| **Change** | Assert `/hesabını bağla/`; `getFirebaseFunctionsSafe(VEHICLE_MARKETPLACE_FUNCTIONS_REGION)`; static auth-required empty state on `VehicleMarketplaceScreen` |
| **Product code** | No |
| **Test-only** | Yes |

---

### 6. `vehicle-marketplace-ui-test.ts`

| Field | Detail |
|-------|--------|
| **Old failure** | esbuild could not parse `react-native` / `expo-modules-core` when importing `backendRoadmap` |
| **Classification** | Test harness incompatibility |
| **Change** | `import './test-globals'` (RN + Expo shims); provider-neutral auth message assert |
| **Product code** | No |
| **Test-only** | Yes (harness) |

**Harness note:** Domain/presentation tests remain **tsx headless scripts** (project convention). No Jest component mount required — current coverage does not import `.tsx` components. `scripts/test-globals.ts` now mocks `react-native`, `expo-constants`, and `globalThis.expo`.

---

## Collateral Fixes (same suite run)

| Script | Reason | Change |
|--------|--------|--------|
| `ads-config-test.ts` | B-003 split AdMob IDs to `adMobConstants.ts` | Read constants from `adMobConstants.ts`; verify re-export from `adMob.ts` |
| `security-malicious-save-trust-test.ts` | Root import of `firebase-admin/firestore` + bare run without emulator | Load `Timestamp` via backend `createRequire`; **SKIP** when `FIRESTORE_EMULATOR_HOST` unset |

---

## Files Touched

| File | Type |
|------|------|
| `scripts/account-switch-flow-test.ts` | test |
| `scripts/debug-contract-generation-test.ts` | test |
| `scripts/phase3-smoke-test.ts` | test |
| `scripts/time-progression-audit-test.ts` | test |
| `scripts/vehicle-marketplace-create-chain-test.ts` | test |
| `scripts/vehicle-marketplace-ui-test.ts` | test |
| `scripts/test-globals.ts` | harness |
| `scripts/ads-config-test.ts` | test |
| `scripts/security-malicious-save-trust-test.ts` | test |

**Product runtime code:** unchanged.

---

## Remaining Test Risk

| Risk | Mitigation |
|------|------------|
| `security-malicious-save-trust-test` SKIP in headless suite | Run with `firebase emulators:exec` before release (same as backend security path) |
| Marketplace auth UI has no inline CTA button (user goes to Şirket → Hesap) | Product choice; test verifies copy + empty-state branch only |
| Account switch Google-specific dialog titles remain for Google picker flow | Provider-neutral sign-out; Google strings only where Google-specific |
| Emulator / device-only flows (ATT, UMP, real AdMob) | Covered by separate B-003 device checklist |

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| Active test suite fully green (headless) | ✅ 65 PASS, 0 FAIL |
| Product not regressed for stale tests | ✅ test-only changes |
| RN test harness works | ✅ `test-globals` Expo/RN shims |
| Real regressions not hidden | ✅ assertions match current product behavior |
