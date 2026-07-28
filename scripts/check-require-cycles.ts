import fs from 'fs';
import path from 'path';

function* walk(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

function resolveImport(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(fromFile), spec));
  for (const candidate of [base + '.ts', base + '.tsx', path.join(base, 'index.ts')]) {
    if (fs.existsSync(candidate)) return path.normalize(candidate);
  }
  return null;
}

const edges = new Map<string, string[]>();
for (const file of walk('src')) {
  const text = fs.readFileSync(file, 'utf8');
  const imports: string[] = [];
  const re = /from\s+['"]([^'"]+)['"]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const resolved = resolveImport(file, match[1]);
    if (resolved) imports.push(resolved);
  }
  edges.set(path.normalize(file), imports);
}

const pairs: Array<[string, string]> = [
  ['src/simulation/delivery.ts', 'src/utils/truckFuel.ts'],
  ['src/utils/truckFuel.ts', 'src/simulation/delivery.ts'],
  ['src/simulation/economy.ts', 'src/simulation/marketPriceTick.ts'],
  ['src/simulation/marketPriceTick.ts', 'src/simulation/economy.ts'],
];

for (const [a, b] of pairs) {
  const A = path.normalize(a);
  const B = path.normalize(b);
  const has = (edges.get(A) ?? []).includes(B);
  console.log(`${a} -> ${b}: ${has}`);
}

let leftover = false;
for (const file of walk('src')) {
  if (fs.readFileSync(file, 'utf8').includes('setLayoutAnimationEnabledExperimental')) {
    leftover = true;
    console.log('leftover in', file);
  }
}
console.log('LayoutAnimation enable leftover:', leftover);
