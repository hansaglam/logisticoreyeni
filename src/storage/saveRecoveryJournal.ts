import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_KEY = '@logisticore/save-recovery/journal-pending-v1';
const RECEIPTS_KEY = '@logisticore/save-recovery/journal-receipts-v1';
export const SAVE_RECOVERY_RECEIPT_LIMIT = 24;

export type SaveRecoveryRestoreSource = 'cloud' | 'local-backup' | 'main';

export interface PendingSaveRecoveryRestore {
  restoreId: string;
  ownerUid: string;
  source: SaveRecoveryRestoreSource;
  startedAt: number;
}

export interface SaveRecoveryRestoreReceipt extends PendingSaveRecoveryRestore {
  completedAt: number;
}

async function readReceipts(): Promise<SaveRecoveryRestoreReceipt[]> {
  try {
    const raw = await AsyncStorage.getItem(RECEIPTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-SAVE_RECOVERY_RECEIPT_LIMIT) : [];
  } catch {
    return [];
  }
}

export async function hasSaveRecoveryRestoreReceipt(restoreId: string): Promise<boolean> {
  return (await readReceipts()).some((receipt) => receipt.restoreId === restoreId);
}

export async function beginSaveRecoveryRestoreJournal(
  entry: PendingSaveRecoveryRestore,
): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(entry));
}

export async function completeSaveRecoveryRestoreJournal(
  entry: PendingSaveRecoveryRestore,
): Promise<void> {
  const receipts = await readReceipts();
  const next = [
    ...receipts.filter((receipt) => receipt.restoreId !== entry.restoreId),
    { ...entry, completedAt: Date.now() },
  ].slice(-SAVE_RECOVERY_RECEIPT_LIMIT);
  await AsyncStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
  await AsyncStorage.removeItem(PENDING_KEY);
}

export async function clearPendingSaveRecoveryRestore(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

export async function getInterruptedSaveRecoveryRestore(): Promise<PendingSaveRecoveryRestore | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSaveRecoveryRestore;
    return parsed?.restoreId && parsed?.ownerUid ? parsed : null;
  } catch {
    return null;
  }
}
