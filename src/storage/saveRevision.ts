/**
 * Monotonic save-content revision — bumps when gameplay state becomes dirty.
 * Used to skip redundant integrity checksum work within the same revision.
 */

let saveContentRevision = 0;
let cachedChecksumRevision = -1;
let cachedIntegrityChecksum: string | null = null;

export function bumpSaveContentRevision(): number {
  saveContentRevision += 1;
  cachedChecksumRevision = -1;
  cachedIntegrityChecksum = null;
  return saveContentRevision;
}

export function getSaveContentRevision(): number {
  return saveContentRevision;
}

export function getCachedIntegrityChecksum(revision: number): string | null {
  if (revision !== saveContentRevision || revision !== cachedChecksumRevision) {
    return null;
  }
  return cachedIntegrityChecksum;
}

export function setCachedIntegrityChecksum(revision: number, checksum: string): void {
  cachedChecksumRevision = revision;
  cachedIntegrityChecksum = checksum;
}

export function resetSaveRevisionState(): void {
  saveContentRevision = 0;
  cachedChecksumRevision = -1;
  cachedIntegrityChecksum = null;
}
