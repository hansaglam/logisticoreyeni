import type { AccountCenterTab } from '../../hooks/useAccountCenter';

export const ACCOUNT_CENTER_TABS: { key: AccountCenterTab; label: string }[] = [
  { key: 'profile', label: 'Profil' },
  { key: 'account', label: 'Hesap' },
  { key: 'preferences', label: 'Tercihler' },
];

export const ACCOUNT_CENTER_HEADER = {
  title: 'Hesap Merkezi',
  subtitle: 'Profil, bulut kaydı ve uygulama tercihleri',
} as const;
