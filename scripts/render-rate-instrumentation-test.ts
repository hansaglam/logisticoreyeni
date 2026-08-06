/**
 * Render-rate instrumentation regression tests.
 * Run: npx tsx scripts/render-rate-instrumentation-test.ts
 */
import './test-globals';

import {
  RENDER_RATE_THRESHOLD,
  RENDER_RATE_WARNING_COOLDOWN_MS,
  RENDER_RATE_WINDOW_MS,
  __getRenderRateTrackerForTest,
  resetRenderRateTrackers,
  trackRenderRate,
} from '../src/utils/renderRateInstrumentation';

(globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

let pass = 0;
let fail = 0;
let warned = 0;
const originalWarn = console.warn;

function assert(condition: boolean, label: string): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  fail += 1;
  console.log(`  ✗ ${label}`);
}

console.log('\n=== Render Rate Instrumentation ===\n');

console.warn = (...args: unknown[]) => {
  if (String(args[0]).includes('[render-loop-suspected]')) {
    warned += 1;
  }
};

try {
  console.log('Rolling window behavior');
  {
    resetRenderRateTrackers();
    warned = 0;
    const component = 'test:spread-renders';
    const context = { tutorialId: 'dashboard' };
    trackRenderRate(component, context);
    const tracker = __getRenderRateTrackerForTest(component, context);
    assert(tracker != null, 'tracker is created');
    if (tracker) {
      const now = Date.now();
      tracker.timestamps = Array.from({ length: 60 }, (_, index) => now - index * 500);
      tracker.totalRenderCount = 60;
      tracker.lastWarningAt = 0;
    }
    trackRenderRate(component, context);
    assert(warned === 0, '60 renders spread over 30s keeps < threshold in 2s window');

    resetRenderRateTrackers();
    warned = 0;
    for (let index = 0; index < 10; index += 1) {
      trackRenderRate('test:low-rate', { tutorialId: 'dashboard' });
    }
    assert(warned === 0, '10 renders in one burst → no warning');

    resetRenderRateTrackers();
    warned = 0;
    for (let index = 0; index < RENDER_RATE_THRESHOLD; index += 1) {
      trackRenderRate('test:threshold', { tutorialId: 'dashboard' });
    }
    assert(warned === 0, 'exactly threshold renders in burst → no warning');

    resetRenderRateTrackers();
    warned = 0;
    for (let index = 0; index < RENDER_RATE_THRESHOLD + 1; index += 1) {
      trackRenderRate('test:hot-loop', { tutorialId: 'dashboard' });
    }
    assert(warned === 1, 'threshold+1 renders in burst → one warning');

    resetRenderRateTrackers();
    warned = 0;
    for (let index = 0; index < RENDER_RATE_THRESHOLD + 5; index += 1) {
      trackRenderRate('test:cooldown', { tutorialId: 'dashboard' });
    }
    assert(warned === 1, 'warning cooldown suppresses repeated warnings in same burst');

    resetRenderRateTrackers();
    warned = 0;
    for (let index = 0; index < RENDER_RATE_THRESHOLD + 1; index += 1) {
      trackRenderRate('test:resume', { tutorialId: 'dashboard' });
    }
    assert(warned === 1, 'first burst warns once');
    const resumeTracker = __getRenderRateTrackerForTest('test:resume', { tutorialId: 'dashboard' });
    if (resumeTracker) {
      resumeTracker.lastWarningAt = Date.now() - RENDER_RATE_WARNING_COOLDOWN_MS - 1;
    }
    for (let index = 0; index < RENDER_RATE_THRESHOLD + 1; index += 1) {
      trackRenderRate('test:resume', { tutorialId: 'dashboard' });
    }
    assert(warned === 2, 'after cooldown another burst can warn again');

    assert(RENDER_RATE_WINDOW_MS === 2000, 'window is 2 seconds');

    resetRenderRateTrackers();
    warned = 0;
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = false;
    trackRenderRate('test:production-off', { tutorialId: 'dashboard' });
    assert(
      __getRenderRateTrackerForTest('test:production-off', { tutorialId: 'dashboard' }) == null,
      'production mode does not create tracker',
    );
    assert(warned === 0, 'production mode does not warn');
    (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ = true;

    resetRenderRateTrackers();
    warned = 0;
    trackRenderRate('test:unmount', { tutorialId: 'dashboard' });
    resetRenderRateTrackers();
    assert(
      __getRenderRateTrackerForTest('test:unmount', { tutorialId: 'dashboard' }) == null,
      'reset clears tracker after unmount',
    );
  }
} finally {
  console.warn = originalWarn;
  resetRenderRateTrackers();
}

console.log(`\nResult: ${pass} passed, ${fail} failed\n`);
process.exit(fail > 0 ? 1 : 0);
