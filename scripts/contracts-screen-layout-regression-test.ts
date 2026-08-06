/**
 * ContractsScreen header layout regression.
 * Run: npx tsx scripts/contracts-screen-layout-regression-test.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(__dirname, '..');
const screenPath = path.join(root, 'src/screens/ContractsScreen.tsx');
const headerPath = path.join(root, 'src/components/ui/ScreenHeader.tsx');

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
    return;
  }
  failed += 1;
  console.log(`  ✗ ${label}`);
}

const screenSource = fs.readFileSync(screenPath, 'utf8');
const headerSource = fs.readFileSync(headerPath, 'utf8');

console.log('\n=== Contracts Screen Layout Regression ===\n');

console.log('ScreenHeader contract');
assert(screenSource.includes('ScreenHeader'), 'ContractsScreen uses ScreenHeader');
assert(screenSource.includes('leftAction'), 'help button in leftAction slot');
assert(screenSource.includes('rightAction'), 'refresh button in rightAction slot');
assert(screenSource.includes('AppTutorialHelpButton'), 'tutorial help wired');
assert(screenSource.includes('icon="refresh"'), 'refresh icon present');
assert(screenSource.includes('Piyasayı Yenile'), 'empty-state refresh CTA');
assert(screenSource.includes('emergency'), 'emergency refresh path');

console.log('\nScreenHeader symmetry');
assert(headerSource.includes('leftAction'), 'ScreenHeader supports leftAction');
assert(headerSource.includes('SIDE_SLOT_WIDTH'), 'fixed side slot width');
assert(headerSource.includes('minHeight: 48'), '48px touch target min height');
assert(headerSource.includes('textAlign: \'center\''), 'centered title');

console.log(`\nPASS: ${passed}`);
console.log(`FAIL: ${failed}`);
if (failed > 0) {
  process.exit(1);
}
console.log('✅ ALL PASS\n');
