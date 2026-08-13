# Tutorial First-Visit-Only Fix — Results

**Date:** 2026-08-13  
**Scope:** Reusable app tutorial auto-start persistence  
**Builds:** AAB/APK/IPA/Xcode Archive **not produced**

---

## 1. Why tutorials re-opened

| Cause | Detail |
|-------|--------|
| **Version bump auto-replay** | `shouldAutoStartTutorial` returned `true` when `entry.version < currentVersion` |
| **`autoAttemptedRef` reset** | On blocker / `!canAutoStart`, ref reset to `false` → remount/retry re-fired auto-start |
| **No `hasBeenPresented`** | Progress only stored `{ completed, version }` on finish — not on first overlay show |
| **Save timing** | `markSaveDirty` only on complete; force-close during tutorial could lose completion |
| **Reputation never auto** | `autoStart: false` prevented first-visit behavior when sheet opened |

---

## 2. Old autoStart logic

```text
shouldAutoStart =
  !completed
  OR storedVersion < currentVersion

mount / blocker clear
→ autoAttemptedRef = false
→ auto-start again
```

---

## 3. New source of truth: `hasBeenPresented`

`TutorialProgressEntry` (`src/tutorial/app/types.ts`):

```ts
{
  version: number;
  hasBeenPresented: boolean;
  status: 'never-seen' | 'completed' | 'skipped' | 'dismissed';
  completedAt?, skippedAt?, dismissedAt?, lastManualReplayAt?
}
```

**Auto-start eligibility:**

```ts
shouldAutoStart = !hasBeenPresented
```

Pure helper: `shouldAutoPresentTutorial({ enabled, hydrated, layoutReady, hasBeenPresented, blockerActive, ... })`

**Version bumps do not re-trigger auto-start.**

---

## 4. When first presentation is persisted

```text
overlay visible
→ prepareStepIndex(0)
→ first step committed + endTransitionUi()
→ markTutorialPresented(tutorialId)   // immediate save dirty
```

Not on mount, not on `visible=true` alone, not before target/fallback step is shown.

---

## 5. Complete / skip / dismiss

| Action | Persistence |
|--------|-------------|
| Complete | `status=completed`, `hasBeenPresented=true` |
| Skip (Atla) | `status=skipped`, `hasBeenPresented=true` |
| Dismiss (back/close) | `status=dismissed`, `hasBeenPresented=true` |

All block future auto-start.

---

## 6. Manual replay (`?`)

- `replayTutorialManually()` / `openManual`
- Does **not** reset `hasBeenPresented` or `status`
- Updates `lastManualReplayAt` (best-effort)
- Outcome persistence skipped during manual replay (same as before)

---

## 7. Blocker behavior

- Before presentation: blockers delay auto-start; `hasBeenPresented` stays `false`
- After presentation: blockers cannot trigger auto replay
- `autoAttemptedRef` is session-only; **no reset on blocker clear** — effect re-runs when `canAutoStart` becomes true

---

## 8. Hydration gate

Auto-start requires `isGameReady` from gameStore (save hydrated).

---

## 9. Market legacy migration

`marketTutorialCompleted` + `marketTutorialVersion` →

```ts
{ hasBeenPresented: true, status: 'completed', version }
```

`useMarketTutorial` uses same presentation/outcome hooks as screen tutorials.

---

## 10. Reputation sheet

- `autoStart: true` when sheet is open
- `blockingModals: !visible` — closed modal does not count as presentation
- First actual sheet open → tutorial once; `?` for manual replay

---

## 11. Key files

| File | Change |
|------|--------|
| `src/tutorial/app/types.ts` | Extended progress model |
| `src/tutorial/app/persistence.ts` | `shouldAutoPresentTutorial`, migration, presented/outcome helpers |
| `src/hooks/useAppTutorial.ts` | Presentation persist, separated auto/manual, dismiss |
| `src/hooks/useScreenAppTutorial.ts` | Hydration + store callbacks |
| `src/hooks/useMarketTutorial.ts` | Aligned with screen hook |
| `src/store/gameStore.ts` | `markTutorialPresented`, `recordTutorialOutcome`, `recordTutorialManualReplay` |
| `scripts/tutorial-first-visit-regression-test.ts` | 43 assertions |

---

## 12. Verification

| Check | Result |
|-------|--------|
| `npm run typecheck` | PASS |
| `npm run verify` | PASS |
| `tutorial-first-visit-regression` | 43/43 |
| `update-loop-regression` | PASS |
| `expo export android/ios` | PASS |
| `git diff --check` | PASS |
| AAB/APK/IPA | **Not produced** |

---

## 13. Manual device acceptance (remaining)

1. Fresh install → Dashboard tutorial auto once  
2. Complete → leave/return → no auto  
3. `?` → manual replay works  
4. After manual replay → leave/return → no auto  
5. Force-close after overlay shown → restart → no auto  
6. Map first visit → Map tutorial once (Dashboard not repeated)  
7. Reputation sheet first open → tutorial once  

---

## 14. Acceptance criteria

- [x] First real presentation only auto-opens  
- [x] Second visit / restart / remount / tab switch → no auto  
- [x] Complete / skip / dismiss all block auto  
- [x] `?` manual replay works without resetting progress  
- [x] Version increase does not auto replay  
- [x] Save hydration required before auto-start  
- [x] Render-loop guards preserved  
- [x] Android + iOS share same TS business logic  
