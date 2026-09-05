import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { AppPreferences } from '../../services/appPreferences';
import { updateAppPreference } from '../../services/appPreferences';
import {
  AD_PRIVACY_NOT_REQUIRED_MESSAGE,
  AD_PRIVACY_OPTIONS_TITLE,
} from '../../domain/adPrivacyState';
import AccountActionRow from './AccountActionRow';
import AccountSectionCard from './AccountSectionCard';
import AccountSettingRow from './AccountSettingRow';
import { ACCOUNT_SECTION_GAP } from './accountCenterTheme';
import { colors, typography } from '../../theme';

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
    title: 'Gelir özeti',
    subtitle: 'Günlük gelir özetini göster',
    icon: 'profit',
  },
];

export interface AccountPreferencesTabProps {
  prefs: AppPreferences;
  appVersion: string;
  buildNumber: string;
  registrationDateLabel: string;
  onLanguagePress: () => void;
  onPrivacyPolicy: () => void;
  adsPrivacyOptionsSupported: boolean;
  showPrivacyOptions: boolean;
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
  onLanguagePress,
  onPrivacyPolicy,
  adsPrivacyOptionsSupported,
  showPrivacyOptions,
  onPrivacyChoices,
  onAccountDeletionInfo,
  onSupport,
  onLegalDocuments,
}: AccountPreferencesTabProps) {
  const versionLabel = `${appVersion} · Build ${buildNumber}`;

  return (
    <View style={styles.tab}>
      <Text style={styles.sectionLabel}>Uygulama</Text>
      <AccountSectionCard compact>
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

      <AccountSectionCard compact>
        <AccountActionRow
          title="Dil"
          subtitle="Türkçe"
          icon="settings"
          onPress={onLanguagePress}
          compact
        />
      </AccountSectionCard>

      <Text style={styles.sectionLabel}>Gizlilik ve Destek</Text>
      <AccountSectionCard compact>
        <AccountActionRow
          title="Gizlilik Politikası"
          subtitle="Veri işleme ve saklama"
          icon="level"
          onPress={onPrivacyPolicy}
          compact
        />
        <View style={styles.divider} />
        {adsPrivacyOptionsSupported ? (
          <>
            {showPrivacyOptions ? (
              <AccountActionRow
                title={AD_PRIVACY_OPTIONS_TITLE}
                subtitle="Reklam ve çerez tercihleri"
                icon="settings"
                onPress={onPrivacyChoices}
                compact
              />
            ) : (
              <View style={styles.staticRow}>
                <Text style={styles.staticTitle}>Gizlilik ve Çerez Ayarları</Text>
                <Text style={styles.staticValue} numberOfLines={2}>
                  {AD_PRIVACY_NOT_REQUIRED_MESSAGE}
                </Text>
              </View>
            )}
            <View style={styles.divider} />
          </>
        ) : null}
        <AccountActionRow
          title="Hesap Silme Bilgileri"
          subtitle="Silme süreci ve kapsam"
          icon="warning"
          onPress={onAccountDeletionInfo}
          compact
        />
        <View style={styles.divider} />
        <AccountActionRow
          title="Destek"
          subtitle="Yardım ve iletişim"
          icon="alert"
          onPress={onSupport}
          compact
        />
      </AccountSectionCard>

      <AccountSectionCard title="Hakkında" compact>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Sürüm</Text>
          <Text style={styles.aboutValue} numberOfLines={1}>
            {versionLabel}
          </Text>
        </View>
        <View style={styles.aboutRow}>
          <Text style={styles.aboutLabel}>Kayıt tarihi</Text>
          <Text style={styles.aboutValue} numberOfLines={1}>
            {registrationDateLabel}
          </Text>
        </View>
        <View style={styles.divider} />
        <AccountActionRow
          title="Yasal Belgeler"
          subtitle="Gizlilik ve kullanım koşulları"
          icon="contract"
          onPress={onLegalDocuments}
          compact
        />
      </AccountSectionCard>
    </View>
  );
}

const styles = StyleSheet.create({
  tab: {
    gap: ACCOUNT_SECTION_GAP,
  },
  sectionLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.textPrimary,
    marginBottom: -6,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(56, 129, 200, 0.1)',
  },
  staticRow: {
    paddingVertical: 8,
    gap: 3,
    minHeight: 48,
  },
  staticTitle: {
    ...typography.bodySmall,
    fontWeight: '700',
    fontSize: 14,
    color: colors.textPrimary,
  },
  staticValue: {
    ...typography.caption,
    color: colors.textSecondary,
    fontSize: 11,
    lineHeight: 14,
  },
  aboutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    minHeight: 36,
  },
  aboutLabel: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  aboutValue: {
    ...typography.bodySmall,
    fontWeight: '700',
    fontSize: 13,
    color: colors.textPrimary,
    flex: 1.2,
    textAlign: 'right',
  },
});
