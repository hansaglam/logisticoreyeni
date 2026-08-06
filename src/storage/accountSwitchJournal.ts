import AsyncStorage from '@react-native-async-storage/async-storage';

const JOURNAL_KEY = '@logisticore/account-switch/journal-v1';

export type AccountSwitchJournalStage =
  | 'preparing'
  | 'syncing-current'
  | 'selecting-provider'
  | 'auth-switched-pending-validation'
  | 'loading-target-cloud'
  | 'awaiting-user-choice'
  | 'committing'
  | 'rolling-back'
  | 'recovery-required'
  | 'completed'
  | 'failed';

export interface AccountSwitchJournal {
  stage: AccountSwitchJournalStage;
  oldUid: string;
  targetUid?: string;
  localOwnerUid: string;
  oldProviderIds: string[];
  provider: 'google' | 'apple' | 'guest';
  startedAt: number;
  commitCompleted: boolean;
  rollbackRequired: boolean;
}

export async function writeAccountSwitchJournal(
  journal: AccountSwitchJournal,
): Promise<void> {
  await AsyncStorage.setItem(JOURNAL_KEY, JSON.stringify(journal));
}

export async function readAccountSwitchJournal(): Promise<AccountSwitchJournal | null> {
  try {
    const raw = await AsyncStorage.getItem(JOURNAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AccountSwitchJournal;
    if (!parsed?.oldUid || !parsed?.localOwnerUid || !parsed?.stage) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function clearAccountSwitchJournal(): Promise<void> {
  await AsyncStorage.removeItem(JOURNAL_KEY);
}
