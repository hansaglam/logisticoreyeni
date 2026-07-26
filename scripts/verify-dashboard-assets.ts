import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DASHBOARD_DIR = path.join(ROOT, 'assets', 'dashboard');

const EXPECTED = [
  'company-emblem-gold.png',
  'dashboard-port-background.png',
  'next-action-truck-route.png',
  'daily-support-ticket.png',
  'dashboard-grid-overlay.png',
] as const;

let missing = 0;

console.log('Dashboard asset verification\n');

for (const filename of EXPECTED) {
  const fullPath = path.join(DASHBOARD_DIR, filename);
  const exists = fs.existsSync(fullPath);
  if (!exists) {
    missing += 1;
    console.log(`MISSING  ${path.relative(ROOT, fullPath)}`);
  } else {
    const stat = fs.statSync(fullPath);
    console.log(`OK       ${path.relative(ROOT, fullPath)} (${stat.size} bytes)`);
  }
}

const zipInDir = fs.existsSync(DASHBOARD_DIR)
  ? fs.readdirSync(DASHBOARD_DIR).filter((name) => name.toLowerCase().endsWith('.zip'))
  : [];

if (zipInDir.length > 0) {
  console.log(`\nWARN     zip files in assets/dashboard/: ${zipInDir.join(', ')}`);
}

console.log(`\nResult: ${EXPECTED.length - missing}/${EXPECTED.length} present`);
process.exit(missing === 0 ? 0 : 1);
