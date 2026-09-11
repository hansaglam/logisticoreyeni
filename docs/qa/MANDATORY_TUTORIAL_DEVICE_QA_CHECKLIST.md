# Mandatory Tutorial — Physical Device QA Checklist

Temporary device QA for mandatory first-run ContextualGuide.

**Runtime UI:** Tutorial QA Reset has been **removed** from Yönetim / Management and DebugSimulation.

For Android / remaining device checks, use a **fresh guest / new linked account**, or DebugSimulation **Test Kaydını Sıfırla** (full wipe — heavy).

---

## Device status

| Surface | Result | Notes |
|---|---|---|
| iOS main flow | **PASS** | Full CTA path + lock verified on device |
| iOS restart/resume | **PASS** (operator) | Durable persist + inactive flush |
| Android physical QA | **PENDING** | Do not mark complete until operator confirms |

---

## Root cause (historical iOS resume FAIL — fixed)

1. Step completion only called `markSaveDirty()` — progress stayed in memory until a later flush.
2. AppState lifecycle deferred background save via `InteractionManager` and primarily flushed on `background`.
3. iOS force-quit often kills during `inactive` without reaching `background`, so dirty `contextualGuide` never hit disk.
4. Cold start then hydrated missing/stale guide state; mandatory UI + lock disappeared.

## Durable fix (code)

- Immediate `autoSave('contextual_guide')` on mandatory step advance / guide complete.
- AppState flushes save **immediately** on both `inactive` and `background` (no InteractionManager defer).
- Resume authority remains saved `contextualGuide.status` + `completedCardIds` via `getCurrentMandatoryTutorialStep`.
- Manual Help replay stays runtime-scoped; `getDurableContextualGuideForSave` keeps pre-replay completion on crash.

---

## Shared setup

1. Prefer a **fresh guest / new linked account** for true-new-player mandatory start.
2. Confirm game has finished hydrating (HUD / tabs visible) before judging auto-start.
3. Optional heavy: Şirket → DEV Araçları → Simülasyon Testi → **Test Kaydını Sıfırla** (full wipe).

**Do not require Save Now** for resume correctness after the durable fix. Optional Save Now is still fine as a belt-and-suspenders check.

---

## A. iOS QA matrix

Device: ________  OS: ________  Build: ________

| # | Case | Pass? | Notes |
|---|---|---|---|
| 1 | True new → tutorial auto-starts after game ready | ☐ | Main flow PASS previously |
| 2 | No dismiss X on mandatory cards | ☐ | Main flow PASS previously |
| 3 | Background / dim blocker present; cannot interact behind card | ☐ | Main flow PASS previously |
| 4 | Manual tab bar switch blocked while mandatory | ☐ | Main flow PASS previously |
| 5 | Welcome CTA → Contracts | ☐ | Main flow PASS previously |
| 6 | Contracts CTA → Fleet | ☐ | Main flow PASS previously |
| 7 | Fleet CTA → Map | ☐ | Main flow PASS previously |
| 8 | Map CTA → Management (Şirket / more) | ☐ | Main flow PASS previously |
| 9 | Final CTA → Dashboard + guide completed | ☐ | Main flow PASS previously |
| 10 | After completion: tabs free, normal gameplay | ☐ | Main flow PASS previously |
| 11 | Kill at step 2 (Contracts) **without Save Now** → reopen resumes Contracts card | ☐ | Operator PASS previously |
| 12 | Kill at step 3 (Fleet) **without Save Now** → Fleet + step 3 card | ☐ | Operator PASS previously |
| 12b | Kill at step 4 (Map) **without Save Now** → Map + step 4 card | ☐ | |
| 13 | Existing completed/skipped player: no mandatory auto-start | ☐ | |
| 14 | Help → Getting Started replay: guided flow works | ☐ | |
| 15 | Replay: exit/dismiss works; durable completion preserved | ☐ | |
| 16 | Small phone: card not clipped; CTA always tappable | ☐ | |
| 17 | No brief unlocked interaction during CTA navigation | ☐ | |
| 18 | No duplicated cards / no nav loop / no crash | ☐ | |

---

## B. Android QA matrix

Device: ________  OS: ________  Build: ________

Same rows as iOS matrix (1–18). ☐ — **PENDING**

Extra Android: back button during mandatory — must not unlock background / break lock. ☐

---

## C. New-player reset method

- **Preferred:** new guest / new Firebase-linked user with empty progress
- **Heavy:** Test Kaydını Sıfırla (full wipe)
- **Removed:** Yönetim Tutorial QA Reset / DebugSimulation QA Reset Mandatory Tutorial

## D. Restart/resume method

1. Reach target step as a true-new or unfinished mandatory player
2. **Do not tap Save Now** (primary proof)
3. Force-quit app
4. Relaunch → expect correct tab + same card + mandatory lock (no X)

## E. Existing-player test

Use account with prior progress **or** completed guide. Expect **no** mandatory auto-start. Help replay still available.

## F. Manual replay test

Şirket → Yardım & Rehber → Getting Started CTA → replay. Exit allowed. Reopen game: durable completion still completed/skipped (not forced mandatory again).

## G. Known risks

- Mid-nav race: brief unlock (watch CTA transitions)
- Small screens: CTA under safe-area / tab bar
- Cloud restore (if ever enabled) could overwrite local guide state — local save is authority today
- Fresh account preferred for cold mandatory start after QA Reset removal

## Removed after cleanup

- `src/contextualGuide/devResetMandatoryTutorial.ts` — **deleted**
- Yönetim **Tutorial QA Reset** card — **removed**
- DebugSimulation **QA: Reset Mandatory Tutorial** button — **removed**
