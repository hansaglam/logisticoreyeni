import React, { useMemo } from 'react';
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

import { createDefaultMissionsState } from '../../config/missions';
import type { QuickAccessAction } from '../../navigation/quickAccessTypes';
import { useGameStore } from '../../store/gameStore';
import { colors, spacing, typography } from '../../theme';
import type { GameIconName } from '../../theme/icons';
import { getMissionDisplayStatus } from '../../utils/missionProgress';
import GameIcon from '../ui/GameIcon';

interface QuickAccessItemDef {
  key: QuickAccessAction;
  label: string;
  icon: GameIconName;
}

const QUICK_ACCESS_ITEMS: QuickAccessItemDef[] = (
  [
    { key: 'fleet', label: 'Filo', icon: 'truck' },
    { key: 'warehouse', label: 'Depolar', icon: 'warehouse' },
    { key: 'finance', label: 'Finans', icon: 'cash' },
    { key: 'missions', label: 'Görevler', icon: 'contract' },
    { key: 'settings', label: 'Ayarlar', icon: 'settings' },
    { key: 'account', label: 'Hesap', icon: 'account' },
  ] as QuickAccessItemDef[]
).filter((item) => __DEV__ || item.key !== 'settings');

interface QuickAccessMenuProps {
  visible: boolean;
  bottomOffset: number;
  onClose: () => void;
  onQuickAccess: (action: QuickAccessAction) => void;
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

export default function QuickAccessMenu({
  visible,
  bottomOffset,
  onClose,
  onQuickAccess,
}: QuickAccessMenuProps) {
  const missionsReadyCount = useMissionsReadyBadge();
  const maxPanelHeight = Dimensions.get('window').height * 0.55;

  const handleItemPress = (action: QuickAccessAction) => {
    onClose();
    onQuickAccess(action);
  };

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
                bounces={false}
              >
                {QUICK_ACCESS_ITEMS.map((item) => {
                  const badgeCount =
                    item.key === 'missions' && missionsReadyCount > 0
                      ? missionsReadyCount
                      : undefined;

                  return (
                    <TouchableOpacity
                      key={item.key}
                      style={styles.tile}
                      activeOpacity={0.85}
                      onPress={() => handleItemPress(item.key)}
                    >
                      <View style={styles.tileIconWrap}>
                        <GameIcon name={item.icon} size={20} color={colors.info} />
                        {badgeCount ? <TileBadge count={badgeCount} /> : null}
                      </View>
                      <Text style={styles.tileLabel} numberOfLines={1}>
                        {item.label}
                      </Text>
                    </TouchableOpacity>
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

const TILE_GAP = 10;

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
    gap: TILE_GAP,
    paddingBottom: 2,
  },
  tile: {
    width: '47.5%',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: colors.cardSoft,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 88,
    justifyContent: 'center',
  },
  tileIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.infoSoft,
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.25)',
  },
  tileLabel: {
    ...typography.caption,
    color: colors.textSecondary,
    fontWeight: '600',
    fontSize: 11,
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
