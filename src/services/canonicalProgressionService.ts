/**
 * Read-only canonical progression subscription. Never writes the save or cash.
 */

import {
  isCanonicalProgressionReadAuthorityAllowed,
  type CanonicalProgressionReadSnapshot,
} from '../domain/canonicalProgressionReadAuthority';

type Listener = () => void;

const EMPTY: CanonicalProgressionReadSnapshot = {
  status: 'idle',
  uid: null,
  doc: null,
  fromCache: false,
  previouslyCanonicalForUid: false,
};

let snapshot: CanonicalProgressionReadSnapshot = { ...EMPTY };
let boundUid: string | null = null;
let unsubscribeDoc: (() => void) | null = null;
const listeners = new Set<Listener>();
const seenCanonicalUids = new Set<string>();

function emit() {
  for (const listener of listeners) listener();
}

export function getCanonicalProgressionReadSnapshot(): CanonicalProgressionReadSnapshot {
  return snapshot;
}

export function subscribeCanonicalProgressionRead(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function clearCanonicalProgressionReadState(): void {
  unsubscribeDoc?.();
  unsubscribeDoc = null;
  boundUid = null;
  snapshot = { ...EMPTY };
  emit();
}

/** Test and internal injection. Production listeners call this with Firestore snapshots. */
export function applyCanonicalProgressionReadSnapshot(next: CanonicalProgressionReadSnapshot): void {
  if (
    next.status === 'ready' &&
    next.uid &&
    snapshot.uid === next.uid &&
    snapshot.status === 'ready' &&
    typeof snapshot.doc?.progressionRevision === 'number' &&
    typeof next.doc?.progressionRevision === 'number' &&
    next.doc.progressionRevision < snapshot.doc.progressionRevision
  ) {
    return;
  }
  if (next.status === 'ready' && next.uid) seenCanonicalUids.add(next.uid);
  snapshot = {
    ...next,
    previouslyCanonicalForUid: next.uid ? seenCanonicalUids.has(next.uid) : false,
  };
  emit();
}

export function bindCanonicalProgressionAccount(uid: string | null, signedIn: boolean): void {
  if (!isCanonicalProgressionReadAuthorityAllowed() || !signedIn || !uid) {
    if (boundUid !== null || snapshot.uid !== null) clearCanonicalProgressionReadState();
    return;
  }
  if (boundUid === uid && (unsubscribeDoc || snapshot.status === 'loading' || snapshot.status === 'ready')) {
    return;
  }
  unsubscribeDoc?.();
  unsubscribeDoc = null;
  boundUid = uid;
  snapshot = {
    status: 'loading',
    uid,
    doc: null,
    fromCache: false,
    previouslyCanonicalForUid: seenCanonicalUids.has(uid),
  };
  emit();
  void attachFirestoreListener(uid);
}

async function attachFirestoreListener(uid: string): Promise<void> {
  try {
    const firebase = await import('./firebase');
    const firestore = await import('firebase/firestore');
    if (!firebase.isFirebaseEnabled()) {
      applyCanonicalProgressionReadSnapshot({
        status: 'error',
        uid,
        doc: null,
        fromCache: false,
        previouslyCanonicalForUid: seenCanonicalUids.has(uid),
      });
      return;
    }
    const db = firebase.getFirestoreSafe();
    if (!db || boundUid !== uid) return;
    const ref = firestore.doc(db, 'users', uid, 'canonicalCompanyProgression', 'current');
    unsubscribeDoc = firestore.onSnapshot(
      ref,
      { includeMetadataChanges: true },
      (snap) => {
        if (boundUid !== uid) return;
        applyCanonicalProgressionReadSnapshot({
          status: snap.exists() ? 'ready' : 'missing',
          uid,
          doc: snap.exists() ? (snap.data() as Record<string, unknown>) : null,
          fromCache: snap.metadata.fromCache,
          previouslyCanonicalForUid: seenCanonicalUids.has(uid),
        });
      },
      () => {
        if (boundUid !== uid) return;
        if (snapshot.status === 'ready' && snapshot.doc) {
          applyCanonicalProgressionReadSnapshot({ ...snapshot, fromCache: true });
          return;
        }
        applyCanonicalProgressionReadSnapshot({
          status: 'error',
          uid,
          doc: null,
          fromCache: false,
          previouslyCanonicalForUid: seenCanonicalUids.has(uid),
        });
      },
    );
  } catch {
    if (boundUid === uid) {
      applyCanonicalProgressionReadSnapshot({
        status: 'error',
        uid,
        doc: null,
        fromCache: false,
        previouslyCanonicalForUid: seenCanonicalUids.has(uid),
      });
    }
  }
}
