import AsyncStorage from '@react-native-async-storage/async-storage';

const PENDING_KEY = '@logisticore/cloud-restore/pending-v1';
const RECEIPTS_KEY = '@logisticore/cloud-restore/receipts-v1';
export const CLOUD_RESTORE_RECEIPT_LIMIT = 24;

export interface PendingCloudRestore {
  restoreId: string;
  ownerUid: string;
  startedAt: number;
}

export interface CloudRestoreReceipt extends PendingCloudRestore {
  completedAt: number;
}

async function readReceipts(): Promise<CloudRestoreReceipt[]> {
  try {
    const raw = await AsyncStorage.getItem(RECEIPTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(-CLOUD_RESTORE_RECEIPT_LIMIT) : [];
  } catch {
    return [];
  }
}

export async function hasCloudRestoreReceipt(restoreId: string): Promise<boolean> {
  return (await readReceipts()).some((receipt) => receipt.restoreId === restoreId);
}

export async function beginCloudRestoreJournal(entry: PendingCloudRestore): Promise<void> {
  await AsyncStorage.setItem(PENDING_KEY, JSON.stringify(entry));
}

export async function completeCloudRestoreJournal(entry: PendingCloudRestore): Promise<void> {
  const receipts = await readReceipts();
  const next = [
    ...receipts.filter((receipt) => receipt.restoreId !== entry.restoreId),
    { ...entry, completedAt: Date.now() },
  ].slice(-CLOUD_RESTORE_RECEIPT_LIMIT);
  await AsyncStorage.setItem(RECEIPTS_KEY, JSON.stringify(next));
  await AsyncStorage.removeItem(PENDING_KEY);
}

export async function clearPendingCloudRestore(): Promise<void> {
  await AsyncStorage.removeItem(PENDING_KEY);
}

export async function getInterruptedCloudRestore(): Promise<PendingCloudRestore | null> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingCloudRestore;
    return parsed?.restoreId && parsed?.ownerUid ? parsed : null;
  } catch {
    return null;
  }
}
