/**
 * LogistiCore - Daha Fazla (Ek Menü) Ekranı
 *
 * Depo, Finans, Simülasyon Testi ve Ayarlar gibi ikincil ekranlara giriş noktası.
 */

import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import ScreenHeader from '../components/ScreenHeader';
import ScreenShell from '../components/ScreenShell';
import InternalTestInfoPanel from '../components/InternalTestInfoPanel';
import { STATUS_BAR_HEIGHT, UI } from '../theme/ui';
import WarehouseScreen from './WarehouseScreen';
import FinanceScreen from './FinanceScreen';
import DebugSimulationScreen from './DebugSimulationScreen';

type MoreRoute = 'menu' | 'warehouse' | 'finance' | 'debug' | 'settings';

interface MenuItem {
  key: MoreRoute;
  label: string;
  subtitle: string;
  icon: string;
  showDeveloperBadge?: boolean;
}

// TODO: Hide Debug Simulation in production builds.
const MENU_ITEMS: MenuItem[] = [
  { key: 'warehouse', label: 'Depolar', subtitle: 'Depo merkezleri ve şehir stokları', icon: '🏬' },
  { key: 'finance', label: 'Finans', subtitle: 'Gelir, gider ve nakit akışı', icon: '💰' },
  {
    key: 'debug',
    label: 'Simülasyon Testi',
    subtitle: 'Zaman, ekonomi ve sözleşme testleri',
    icon: '🛠️',
    showDeveloperBadge: true,
  },
  { key: 'settings', label: 'Ayarlar', subtitle: 'Yakında', icon: '⚙️' },
];

const CARD_BORDER = '#263548';
const CHEVRON_COLOR = '#9CA3AF';
const DEVELOPER_BADGE_COLOR = '#F59E0B';

export default function MoreScreen() {
  const [route, setRoute] = useState<MoreRoute>('menu');

  if (route === 'warehouse') {
    return (
      <View style={styles.embeddedRoot}>
        <SubNavBar title="Depolar" onBack={() => setRoute('menu')} />
        <WarehouseScreen />
      </View>
    );
  }

  if (route === 'finance') {
    return (
      <View style={styles.embeddedRoot}>
        <SubNavBar title="Finans" onBack={() => setRoute('menu')} />
        <FinanceScreen />
      </View>
    );
  }

  if (route === 'debug') {
    return (
      <View style={styles.embeddedRoot}>
        <SubNavBar title="Simülasyon Testi" onBack={() => setRoute('menu')} />
        <DebugSimulationScreen />
      </View>
    );
  }

  if (route === 'settings') {
    return (
      <ScreenShell>
        <SubNavBar title="Ayarlar" onBack={() => setRoute('menu')} />
        <View style={styles.settingsCard}>
          <Text style={styles.settingsTitle}>Ayarlar</Text>
          <Text style={styles.settingsText}>Oyun ayarları yakında eklenecek.</Text>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell>
      <ScreenHeader title="Daha Fazla" subtitle="Yönetim, finans ve gelişmiş araçlar" />
      <InternalTestInfoPanel />
      {MENU_ITEMS.map((item) => (
        <TouchableOpacity
          key={item.key}
          style={styles.menuRow}
          onPress={() => setRoute(item.key)}
          activeOpacity={0.85}
        >
          <View style={styles.menuIconBox}>
            <Text style={styles.menuIcon}>{item.icon}</Text>
          </View>
          <View style={styles.menuBody}>
            <View style={styles.menuTitleRow}>
              <Text style={styles.menuLabel}>{item.label}</Text>
              {item.showDeveloperBadge ? (
                <View style={styles.developerBadge}>
                  <Text style={styles.developerBadgeText}>Geliştirici</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
          </View>
          <Text style={styles.menuChevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScreenShell>
  );
}

function SubNavBar({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.subNav}>
      <TouchableOpacity style={styles.subNavBack} onPress={onBack} activeOpacity={0.8}>
        <Text style={styles.subNavBackText}>‹ Daha Fazla</Text>
      </TouchableOpacity>
      <Text style={styles.subNavTitle} numberOfLines={1}>
        {title}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  embeddedRoot: {
    flex: 1,
    backgroundColor: UI.colors.background,
    paddingTop: STATUS_BAR_HEIGHT,
  },
  subNav: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: UI.spacing.screen,
    paddingTop: 8,
    paddingBottom: 4,
    backgroundColor: UI.colors.background,
    borderBottomWidth: 1,
    borderBottomColor: UI.colors.border,
  },
  subNavBack: {
    paddingVertical: 6,
    paddingRight: 12,
  },
  subNavBackText: {
    color: UI.colors.primary,
    fontSize: 14,
    fontWeight: '700',
  },
  subNavTitle: {
    color: UI.colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: UI.colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    paddingVertical: 17,
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  menuIconBox: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: UI.colors.cardAlt,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 14,
  },
  menuIcon: {
    fontSize: 21,
  },
  menuBody: {
    flex: 1,
    minWidth: 0,
  },
  menuTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  menuLabel: {
    color: UI.colors.text,
    fontSize: 17,
    fontWeight: '700',
  },
  menuSubtitle: {
    color: UI.colors.textMuted,
    fontSize: 13,
    marginTop: 3,
    lineHeight: 18,
  },
  developerBadge: {
    borderWidth: 1,
    borderColor: DEVELOPER_BADGE_COLOR,
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  developerBadgeText: {
    color: DEVELOPER_BADGE_COLOR,
    fontSize: 10,
    fontWeight: '800',
  },
  menuChevron: {
    color: CHEVRON_COLOR,
    fontSize: 22,
    fontWeight: '700',
    marginLeft: 8,
  },
  settingsCard: {
    backgroundColor: UI.colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: CARD_BORDER,
    padding: 16,
    marginTop: 8,
  },
  settingsTitle: {
    color: UI.colors.text,
    fontSize: 17,
    fontWeight: '700',
    marginBottom: 6,
  },
  settingsText: {
    color: UI.colors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
});
