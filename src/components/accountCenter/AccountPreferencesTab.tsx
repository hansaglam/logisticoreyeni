import React from 'react';
import { StyleSheet, View } from 'react-native';

import type { AppPreferences } from '../../services/appPreferences';
import { updateAppPreference } from '../../services/appPreferences';
import AccountActionRow from './AccountActionRow';
import AccountInfoRow from './AccountInfoRow';
import AccountSectionCard from './AccountSectionCard';
import AccountSettingRow from './AccountSettingRow';
import DangerZoneCard from './DangerZoneCard';
import { ACCOUNT_SECTION_GAP } from './accountCenterTheme';

const SETTING_ROWS: {
  key: keyof AppPreferences;
  title: string;
  subtitle: string;
  icon: 'notification' | 'cog' | 'play' | 'profit';
}[] = [
  {
    key: 'notificationsEnabled',
    title: 'Bildirimler',
    subtitle: 'Teslimat ve filo bildirimleri',
    icon: 'notification',
  },
  {
    key: 'vibrationEnabled',
    title: 'Titreşim',
    subtitle: 'Uyarılarda titreşim kullan',
    icon: 'cog',
  },
  {
    key: 'soundEnabled',
    title: 'Ses',
    subtitle: 'Bildirim ve uyarı sesleri',
    icon: 'play',
  },
  {
    key: 'incomeSummaryEnabled',
    title: 'Gelir özeti penceresi',
    subtitle: 'Günlük gelir özetini göster',
    icon: 'profit',
  },
];

export interface AccountPreferencesTabProps {
  prefs: AppPreferences;
  appVersion: string;
  buildNumber: string;
  registrationDateLabel: string;
  dangerExpanded: boolean;
  onToggleDanger: () => void;
  isSigningOut: boolean;
  isDeleting: boolean;
  isSwitchingAccount: boolean;
  isGuest: boolean;
  isReady: boolean;
  deleteConfirmStep: 0 | 1;
  onSignOut: () => void;
  onDeleteAccount: () => void;
  onLanguagePress: () => void;
  onPrivacyPolicy: () => void;
  onPrivacyChoices: () => void;
  onAccountDeletionInfo: () => void;
  onSupport: () => void;
  onLegalDocuments: () => void;
}

export default function AccountPreferencesTab({
  prefs,
  appVersion,
  buildNumber,
  registrationDateLabel,
  dangerExpanded,
  onToggleDanger,
  isSigningOut,
  isDeleting,
  isSwitchingAccount,
  isGuest,
  isReady,
  deleteConfirmStep,
  onSignOut,
  onDeleteAccount,
  onLanguagePress,
  onPrivacyPolicy,
  onPrivacyChoices,
  onAccountDeletionInfo,
  onSupport,
  onLegalDocuments,
}: AccountPreferencesTabProps) {
  return (
    <View style={styles.tab}>
      <AccountSectionCard title="Uygulama Ayarları">
        {SETTING_ROWS.map((row, index) => (
          <View key={row.key}>
            <AccountSettingRow
              title={row.title}
              subtitle={row.subtitle}
              icon={row.icon}
              value={prefs[row.key]}
              onValueChange={(value) => {
                void updateAppPreference(row.key, value);
              }}
            />
            {index < SETTING_ROWS.length - 1 ? <View style={styles.divider} /> : null}
          </View>
        ))}
      </AccountSectionCard>

      <AccountSectionCard>
        <AccountActionRow
          title="Dil"
          subtitle="Türkçe"
          icon="settings"
          onPress={onLanguagePress}
        />
      </AccountSectionCard>

      <AccountSectionCard title="Gizlilik ve Destek">
        <AccountActionRow
          title="Gizlilik Politikası"
          subtitle="Veri işleme ve saklama"
          icon="level"
          onPress={onPrivacyPolicy}
        />
        <View style={styles.divider} />
        <AccountActionRow
          title="Gizlilik ve Çerez Ayarları"
          subtitle="Reklam ve çerez tercihleri"
          icon="settings"
          onPress={onPrivacyChoices}
        />
        <View style={styles.divider} />
        <AccountActionRow
          title="Hesap Silme Bilgileri"
          subtitle="Silme süreci ve kapsam"
          icon="warning"
          onPress={onAccountDeletionInfo}
        />
        <View style={styles.divider} />
        <AccountActionRow
          title="Destek"
          subtitle="Yardım ve iletişim"
          icon="alert"
          onPress={onSupport}
        />
      </AccountSectionCard>

      <AccountSectionCard title="Hakkında">
        <AccountInfoRow label="Uygulama sürümü" value={appVersion} />
        <AccountInfoRow label="Build" value={buildNumber} />
        <AccountInfoRow label="Kayıt tarihi" value={registrationDateLabel} />
        <View style={styles.divider} />
        <AccountActionRow
          title="Yasal Belgeler"
          subtitle="Gizlilik ve kullanım koşulları"
          icon="contract"
          onPress={onLegalDocuments}
        />
      </AccountSectionCard>

      <DangerZoneCard
        expanded={dangerExpanded}
        onToggle={onToggleDanger}
        isSigningOut={isSigningOut}
        isDeleting={isDeleting}
        isSwitchingAccount={isSwitchingAccount}
        isGuest={isGuest}
        isReady={isReady}
        deleteConfirmStep={deleteConfirmStep}
        onSignOut={onSignOut}
        onDelete={onDeleteAccount}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    gap: ACCOUNT_SECTION_GAP,
    paddingBottom: 8,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(56, 129, 200, 0.1)',
    marginVertical: 2,
  },
});
