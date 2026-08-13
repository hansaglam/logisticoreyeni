/**
 * Dry-run audit for vehicleMarketplaceListings schema health.
 * Run: npx tsx backend/scripts/auditMarketplaceListings.ts --dry-run
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

import { normalizeStoredMarketplaceListing } from '../src/vehicleMarketplaceSerialization';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const limitArg = process.argv.find((arg) => arg.startsWith('--limit='));
  const limit = limitArg ? Number(limitArg.split('=')[1]) : 500;

  initializeApp();
  const firestore = getFirestore();

  let total = 0;
  let valid = 0;
  let legacy = 0;
  let invalid = 0;
  let fixable = 0;

  const samples: Array<{ id: string; field: string; reason: string }> = [];

  const snapshot = await firestore.collection('vehicleMarketplaceListings').limit(limit).get();
  for (const doc of snapshot.docs) {
    total += 1;
    const raw = doc.data() as Record<string, unknown>;
    const parsed = normalizeStoredMarketplaceListing(raw, doc.id);
    if (parsed.ok) {
      valid += 1;
      if (raw.status === 'available' || raw.truck || raw.catalogId) {
        legacy += 1;
        fixable += 1;
      }
      continue;
    }
    invalid += 1;
    if (samples.length < 10) {
      samples.push({ id: doc.id, field: parsed.field, reason: parsed.reason });
    }
    const hasCore =
      typeof raw.sellerUid === 'string' &&
      (raw.truckSnapshot != null || raw.truck != null) &&
      (raw.askingPrice != null || raw.price != null);
    if (hasCore) fixable += 1;
  }

  console.log(
    JSON.stringify(
      {
        dryRun,
        scanned: total,
        valid,
        legacy,
        invalid,
        fixable,
        unfixable: invalid - fixable,
        samples,
      },
      null,
      2,
    ),
  );

  if (!dryRun) {
    console.error('Refusing to mutate production data without an explicit migration command.');
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
