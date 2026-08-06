import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const src = readFileSync('src/components/AccountSection.tsx', 'utf8');
const lines = src.split(/\r?\n/);

const helperEnd = lines.findIndex((l, i) => i > 200 && l.startsWith('export default function AccountSection'));
const hookStart = helperEnd;
const hookEnd = lines.findIndex((l, i) => i > hookStart && l.trim() === 'return (');

const helpers = lines.slice(0, helperEnd).join('\n');
const hookBody = lines
  .slice(hookStart, hookEnd)
  .join('\n')
  .replace(
    'export default function AccountSection({',
    'export function useAccountCenter({',
  );

const hookFile = `${helpers.replace(/^function /gm, 'export function ')}

export type AccountCenterTab = 'profile' | 'account' | 'preferences';

${hookBody}
  return {
    showAlert,
    showDialog,
    hideDialog,
    account,
    safeAccountStatus,
    cloudStatus,
    cloudUserStatus,
    isGuest,
    showApple,
    showGoogle,
    providerLabel,
    usernameLabel,
    avatarLetter,
    leaderboardStatus,
    isLinking,
    isManualSyncing,
    isChecking,
    isSwitchingAccount,
    isSigningOut,
    isDeleting,
    googleConfigured,
    usernameProfile,
    usernameModal,
    setUsernameModal,
    handleLink,
    handleManualSync,
    handleCheckCloud,
    handleAccountSwitch,
    handleGoogleSignOut,
    handleDeleteAccount,
    refreshUsernameProfile,
    onOpenLeaderboard,
    formatLastSaveLabel,
  };
}
`;

mkdirSync('src/hooks', { recursive: true });
writeFileSync('src/hooks/useAccountCenter.ts', hookFile);
console.log('Wrote useAccountCenter.ts', hookFile.split('\n').length, 'lines');
