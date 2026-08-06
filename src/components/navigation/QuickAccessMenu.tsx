import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { VEHICLE_MARKETPLACE_ENABLED } from '../../config/backendRoadmap';
import { createDefaultMissionsState } from '../../config/missions';
import {
  buildQuickAccessItems,
  QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO,
  QUICK_ACCESS_TILE_GAP,
  QUICK_ACCESS_TILE_HEIGHT,
  type QuickAccessIconTone,
  type QuickAccessItemDef,
} from '../../navigation/quickAccessConfig';
import type { QuickAccessAction } from '../../navigation/quickAccessTypes';
import {
  getAccountStatus,
  subscribeAuthState,
  type AccountStatus,
} from '../../services/authService';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import { getMissionDisplayStatus } from '../../utils/missionProgress';
import GameIcon from '../ui/GameIcon';

interface QuickAccessMenuProps {
  visible: boolean;
  bottomOffset: number;
  onClose: () => void;
  onQuickAccess: (action: QuickAccessAction) => void;
}

function resolveAccountSubtitle(status: AccountStatus): string {
  if (!status.isReady) {
    return 'Profil ve ayarlar';
  }
  const isGuest = status.isAnonymous || status.provider === 'guest';
  return isGuest ? 'Misafir hesap' : 'Bağlı hesap';
}

function useAccountCardSubtitle(): string {
  const [subtitle, setSubtitle] = useState(() =>
    resolveAccountSubtitle(getAccountStatus()),
  );

  React.useEffect(() => {
    const refresh = () => {
      setSubtitle(resolveAccountSubtitle(getAccountStatus()));
    };
    refresh();
    return subscribeAuthState(refresh);
  }, []);

  return subtitle;
}

function useMissionsReadyBadge(): number {
  const missions = useGameStore((state) => state.missions);
  const getMissionProgressValue = useGameStore((state) => state.getMissionProgressValue);

  return useMemo(() => {
    const state = missions ?? createDefaultMissionsState();
    const activeIds = state.activeMissionIds ?? [];
    return activeIds.filter((missionId) => {
      const progress = getMissionProgressValue(missionId);
      return getMissionDisplayStatus(missionId, state, progress) === 'ready';
    }).length;
  }, [missions, getMissionProgressValue]);
}

function TileBadge({ count }: { count: number }) {
  const label = count > 99 ? '99+' : String(count);
  return (
    <View style={styles.tileBadge}>
      <Text style={styles.tileBadgeText}>{label}</Text>
    </View>
  );
}

function resolveIconColor(tone: QuickAccessIconTone | undefined): string {
  return tone === 'amber' ? colors.accentAmber : colors.info;
}

function resolveIconWrapStyle(tone: QuickAccessIconTone | undefined) {
  return tone === 'amber' ? styles.tileIconWrapAmber : styles.tileIconWrapInfo;
}

function QuickAccessTile({
  item,
  subtitle,
  badgeCount,
  onPress,
}: {
  item: QuickAccessItemDef;
  subtitle?: string;
  badgeCount?: number;
  onPress: () => void;
}) {
  const iconColor = resolveIconColor(item.iconTone);

  return (
    <TouchableOpacity
      style={styles.tile}
      activeOpacity={0.85}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={item.accessibilityLabel}
      accessibilityHint={item.accessibilityHint}
    >
      <View style={[styles.tileIconWrap, resolveIconWrapStyle(item.iconTone)]}>
        <GameIcon name={item.icon} size={20} color={iconColor} />
        {badgeCount ? <TileBadge count={badgeCount} /> : null}
      </View>
      <Text style={styles.tileLabel} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.85}>
        {item.label}
      </Text>
      {subtitle ? (
        <Text style={styles.tileSubtitle} numberOfLines={2} adjustsFontSizeToFit minimumFontScale={0.8}>
          {subtitle}
        </Text>
      ) : null}
    </TouchableOpacity>
  );
}

export default function QuickAccessMenu({
  visible,
  bottomOffset,
  onClose,
  onQuickAccess,
}: QuickAccessMenuProps) {
  const missionsReadyCount = useMissionsReadyBadge();
  const accountSubtitle = useAccountCardSubtitle();
  const tapLockRef = useRef(false);
  const maxPanelHeight = Dimensions.get('window').height * QUICK_ACCESS_PANEL_MAX_HEIGHT_RATIO;

  const quickAccessItems = useMemo(
    () => buildQuickAccessItems(VEHICLE_MARKETPLACE_ENABLED),
    [],
  );

  const handleItemPress = useCallback(
    (action: QuickAccessAction) => {
      if (tapLockRef.current) {
        return;
      }
      tapLockRef.current = true;
      onClose();
      requestAnimationFrame(() => {
        onQuickAccess(action);
        setTimeout(() => {
          tapLockRef.current = false;
        }, 450);
      });
    },
    [onClose, onQuickAccess],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.panel, { bottom: bottomOffset }]} pointerEvents="box-none">
          <Pressable onPress={(event) => event.stopPropagation()}>
            <View style={[styles.panelInner, { maxHeight: maxPanelHeight }]}>
              <Text style={styles.panelTitle}>Yönetim</Text>
              <Text style={styles.panelSubtitle}>Filo, finans ve şirket araçları</Text>
              <ScrollView
                style={styles.gridScroll}
                contentContainerStyle={styles.grid}
                showsVerticalScrollIndicator={false}
                bounces
                keyboardShouldPersistTaps="handled"
              >
                {quickAccessItems.map((item) => {
                  const badgeCount =
                    item.key === 'missions' && missionsReadyCount > 0
                      ? missionsReadyCount
                      : undefined;
                  const subtitle =
                    item.key === 'account'
                      ? accountSubtitle
                      : item.subtitle;

                  return (
                    <QuickAccessTile
                      key={item.key}
                      item={item}
                      subtitle={subtitle}
                      badgeCount={badgeCount}
                      onPress={() => handleItemPress(item.key)}
                    />
                  );
                })}
              </ScrollView>
            </View>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(5, 10, 18, 0.45)',
  },
  panel: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
  },
  panelInner: {
    backgroundColor: colors.surface2,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.28)',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    elevation: 10,
    shadowColor: colors.info,
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
  },
  panelTitle: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontSize: 14,
    textAlign: 'center',
    fontWeight: '700',
  },
  panelSubtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  gridScroll: {
    flexGrow: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    columnGap: QUICK_ACCESS_TILE_GAP,
    rowGap: QUICK_ACCESS_TILE_GAP,
    paddingBottom: 4,
  },
  tile: {
    width: '48.4%',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 16,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: QUICK_ACCESS_TILE_HEIGHT,
    justifyContent: 'center',
  },
  tileIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  tileIconWrapInfo: {
    backgroundColor: colors.infoSoft,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  tileIconWrapAmber: {
    backgroundColor: 'rgba(245, 158, 11, 0.14)',
    borderColor: 'rgba(245, 158, 11, 0.28)',
  },
  tileLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 11,
    textAlign: 'center',
  },
  tileSubtitle: {
    color: colors.textMuted,
    fontSize: 9,
    marginTop: -2,
    textAlign: 'center',
    lineHeight: 12,
  },
  tileBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentAmber,
    borderWidth: 1.5,
    borderColor: colors.surface2,
  },
  tileBadgeText: {
    color: '#FFF',
    fontSize: 9,
    fontWeight: '800',
    lineHeight: 11,
  },
});

export { buildQuickAccessItems };
