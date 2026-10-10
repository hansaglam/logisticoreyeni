# Map V2 — Device matrix

**Phase:** 0 Step 4  
**Policy:** Test **classes**, not brand guarantees. Do **not** invent hardware the team does not own.

Repository mentions (example only, not a completeness claim): internal Android E2E has used an emulator/device id `Pixel_6` in one canary command. That does **not** freeze Pixel 6 as the only reference device.

Exact models are chosen at spike/QA time from **devices actually available**.

---

## 1. Classes

| Class | Role | Future test goals |
|---|---|---|
| `ANDROID_LOW` | Supported low RAM / older GPU | `MINIMUM_ACCEPTABLE_FPS` (30), usable pan, no crash, package load, touch |
| `ANDROID_MID` | **PRIMARY_REFERENCE** | 60 fps **target** on pan/pinch, cold/warm open, memory loops |
| `ANDROID_HIGH` | HIGH_END_REFERENCE | Headroom; catch HIGH-tier effect cost |
| `IOS_OLDER_SUPPORTED` | **SECONDARY_REFERENCE** (oldest supported iOS in matrix, ≥15.1) | 30–60 depending on SoC; memory; Skia/Metal |
| `IOS_CURRENT` | HIGH_END_REFERENCE | Flagship-only optimizations must not be required for ship |

**Why mid Android is primary:** optimizing only on flagship iPhones hides the live map’s real constraints (already seen with PNG size / tick-driven MapScreen).

---

## 2. Platform facts that bound the matrix

- Android **minSdk inherited** (Expo modules default **24**)
- iOS **15.1**
- **Portrait only**; tablets unsupported on iOS (`supportsTablet: false`)
- Hermes + New Architecture **on**

A device below min OS is **out of matrix**.

---

## 3. Per-class checklist (when Map V2 exists)

- FPS / p95 frame time (pan, pinch, idle with 1–N vehicles)
- Cold / warm map open
- Memory 20× enter/exit
- Crash / error boundary retry
- Touch vs gesture conflict with sheets
- Country package load (or bundled TR)
- Background/resume
- Offline with installed package

---

## 4. Benchmark policy

| Alias | Class |
|---|---|
| PRIMARY_REFERENCE | ANDROID_MID |
| SECONDARY_REFERENCE | IOS_OLDER_SUPPORTED |
| HIGH_END_REFERENCE | IOS_CURRENT and ANDROID_HIGH |

Record model, OS, and build fingerprint (`app.config.js` extra.buildFingerprint) on every accepted profile.
