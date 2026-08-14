/**
 * LogistiCore - Geliştirmeler (Upgrade Hub V1.1)
 *
 * Filo kamyon yükseltmeleri + şirket preview sekmesi.
 * Filo sekmesi FleetUpgradesPanel ile paylaşılır.
 */

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import FleetUpgradesPanel from '../components/fleet/FleetUpgradesPanel';
import {
  AppCard,
  AppScreen,
  GameIcon,
  ScreenHeader,
  StatusBadge,
} from '../components/ui';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { colors, formatMoney, spacing, typography } from '../theme';
import { useGameStore } from '../store/gameStore';

type UpgradesTab = 'fleet' | 'company';

interface UpgradesScreenProps {
  truckId?: string | null;
  onBack: () => void;
  backLabel?: string;
}

interface CompanyPreviewItem {
  id: string;
  title: string;
  description: string;
}

const COMPANY_PREVIEW_ITEMS: CompanyPreviewItem[] = [
  {
    id: 'operations',
    title: 'Operasyon Yönetimi',
    description: 'Teslimat planlama ve rota verimliliği',
  },
  {
    id: 'warehouse',
    title: 'Depo Verimliliği',
    description: 'Depo kapasitesi ve işlem maliyetleri',
  },
  {
    id: 'contracts',
    title: 'Sözleşme Ağı',
    description: 'Daha kârlı ve prestijli işler',
  },
  {
    id: 'market',
    title: 'Piyasa Analizi',
    description: 'Ürün fiyat tahminleri ve fırsatlar',
  },
];

const TabButton = React.memo(function TabButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.tabButton, active && styles.tabButtonActive]}>
      <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>{label}</Text>
    </Pressable>
  );
});

function CompanyPreviewCard({ item }: { item: CompanyPreviewItem }) {
  return (
    <AppCard style={styles.companyCard} padded>
      <View style={styles.companyCardTop}>
        <Text style={styles.companyCardTitle}>{item.title}</Text>
        <StatusBadge label="Yakında" variant="muted" size="sm" />
      </View>
      <Text style={styles.companyCardDescription}>{item.description}</Text>
      <View style={styles.companyLockedRow}>
        <GameIcon name="settings" size={14} color={colors.textMuted} />
        <Text style={styles.companyLockedText}>Bu geliştirme yakında eklenecek</Text>
      </View>
    </AppCard>
  );
}

export default function UpgradesScreen({
  truckId,
  onBack,
  backLabel = '‹ Geri',
}: UpgradesScreenProps) {
  const { contentBottomPadding } = useTabBarLayout();
  const playerMoney = useGameStore((state) => state.player?.money ?? 0);
  const [activeTab, setActiveTab] = useState<UpgradesTab>('fleet');
  const bottomPadding = contentBottomPadding + spacing.xl;

  return (
    <AppScreen scroll scrollBottomPadding={bottomPadding}>
      <View style={styles.topNav}>
        <Pressable style={styles.backButton} onPress={onBack}>
          <Text style={styles.backButtonText}>{backLabel}</Text>
        </Pressable>
      </View>

      <ScreenHeader
        title="Geliştirmeler"
        subtitle="Filo teknolojileri ve şirket yükseltmeleri"
        titleIcon="upgrade"
        compact
      />

      <View style={styles.cashStrip}>
        <GameIcon name="cash" size={16} color={colors.success} />
        <Text style={styles.cashLabel}>Nakit</Text>
        <Text style={styles.cashValue}>{formatMoney(playerMoney)}</Text>
      </View>

      <View style={styles.tabRow}>
        <TabButton label="Filo" active={activeTab === 'fleet'} onPress={() => setActiveTab('fleet')} />
        <TabButton
          label="Şirket"
          active={activeTab === 'company'}
          onPress={() => setActiveTab('company')}
        />
      </View>

      {activeTab === 'fleet' ? (
        <FleetUpgradesPanel initialTruckId={truckId} />
      ) : (
        <>
          <AppCard variant="soft" style={styles.companyIntroCard} padded>
            <Text style={styles.companyIntroTitle}>Şirket Geliştirmeleri</Text>
            <Text style={styles.companyIntroText}>
              Şirket geneli yetenek ağacı yakında eklenecek. Bu sürümde yalnızca önizleme
              gösterilir.
            </Text>
          </AppCard>
          <View style={styles.companyList}>
            {COMPANY_PREVIEW_ITEMS.map((item) => (
              <CompanyPreviewCard key={item.id} item={item} />
            ))}
          </View>
        </>
      )}
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  topNav: {
    marginBottom: spacing.xs,
  },
  backButton: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
    paddingVertical: 8,
  },
  backButtonText: {
    color: colors.accentAmber,
    fontSize: 14,
    fontWeight: '700',
  },
  cashStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.successSoft,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.success,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginBottom: spacing.md,
  },
  cashLabel: {
    ...typography.bodySmall,
    color: colors.textSecondary,
    flex: 1,
  },
  cashValue: {
    ...typography.bodySmall,
    fontWeight: '800',
    color: colors.success,
  },
  tabRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  tabButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.cardSoft,
    alignItems: 'center',
  },
  tabButtonActive: {
    borderColor: colors.accentAmber,
    backgroundColor: colors.accentAmberSoft,
  },
  tabButtonText: {
    ...typography.bodySmall,
    color: colors.textMuted,
    fontWeight: '700',
  },
  tabButtonTextActive: {
    color: colors.accentAmber,
  },
  companyIntroCard: {
    marginBottom: spacing.md,
  },
  companyIntroTitle: {
    ...typography.cardTitle,
    marginBottom: 4,
  },
  companyIntroText: {
    ...typography.caption,
    lineHeight: 16,
  },
  companyList: {
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  companyCard: {
    gap: spacing.sm,
  },
  companyCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  companyCardTitle: {
    ...typography.cardTitle,
    fontSize: 15,
    flex: 1,
  },
  companyCardDescription: {
    ...typography.caption,
    lineHeight: 16,
  },
  companyLockedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  companyLockedText: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
