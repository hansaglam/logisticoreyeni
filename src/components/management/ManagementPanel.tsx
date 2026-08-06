import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import type { FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { QuickAccessAction } from '../../navigation/quickAccessTypes';
import { colors, spacing, typography } from '../../theme';
import GameIcon from '../ui/GameIcon';
import ManagementGrid from './ManagementGrid';
import {
  MANAGEMENT_HEADER_GAP,
  MANAGEMENT_PANEL_MAX_HEIGHT_RATIO,
  MANAGEMENT_PANEL_PADDING,
} from './managementTheme';
import { estimateManagementPanelContentHeight } from './managementLayout';
import type { ManagementItem } from './managementTypes';
import { useManagementItems } from './useManagementPanelData';

export interface ManagementPanelProps {
  visible: boolean;
  bottomOffset: number;
  onClose: () => void;
  onQuickAccess: (action: QuickAccessAction) => void;
}

export default function ManagementPanel({
  visible,
  bottomOffset,
  onClose,
  onQuickAccess,
}: ManagementPanelProps) {
  const items = useManagementItems();
  const listRef = useRef<FlatList<ManagementItem>>(null);
  const tapLockRef = useRef(false);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const panelContentWidth =
    windowWidth - spacing.lg * 2 - MANAGEMENT_PANEL_PADDING * 2;
  const scrollBottomPadding = Math.max(bottomOffset, spacing.md) + spacing.sm;

  const maxPanelHeightCap =
    windowHeight * MANAGEMENT_PANEL_MAX_HEIGHT_RATIO - Math.max(insets.top, 0) * 0.15;

  const naturalPanelHeight = useMemo(
    () => estimateManagementPanelContentHeight(items.length) + scrollBottomPadding,
    [items.length, scrollBottomPadding],
  );

  const panelHeight = Math.min(naturalPanelHeight, maxPanelHeightCap);
  const needsScroll = naturalPanelHeight > maxPanelHeightCap;

  useEffect(() => {
    if (visible) {
      listRef.current?.scrollToOffset({ offset: 0, animated: false });
      tapLockRef.current = false;
    }
  }, [visible]);

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

  const listHeader = (
    <View style={styles.header}>
      <View style={styles.headerIconWrap}>
        <GameIcon name="quickAccess" size={18} color={colors.info} />
      </View>
      <View style={styles.headerCopy}>
        <Text style={styles.title}>Yönetim</Text>
        <Text style={styles.subtitle}>Şirketini, filonu ve operasyonlarını yönet</Text>
      </View>
    </View>
  );

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View
          style={[styles.panelAnchor, { bottom: bottomOffset }]}
          pointerEvents="box-none"
        >
          <Pressable style={styles.panelPressable} onPress={(event) => event.stopPropagation()}>
            <View
              style={[styles.panel, { height: panelHeight, maxHeight: maxPanelHeightCap }]}
              accessibilityViewIsModal
            >
              <ManagementGrid
                listRef={listRef}
                items={items}
                contentWidth={panelContentWidth}
                onItemPress={handleItemPress}
                listHeaderComponent={listHeader}
                contentBottomPadding={scrollBottomPadding}
                scrollEnabled={needsScroll}
              />
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
    backgroundColor: 'rgba(5, 10, 18, 0.52)',
  },
  panelAnchor: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    alignItems: 'stretch',
  },
  panelPressable: {
    width: '100%',
    alignSelf: 'stretch',
  },
  panel: {
    width: '100%',
    backgroundColor: colors.surface2,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: 'rgba(56, 129, 200, 0.28)',
    paddingHorizontal: MANAGEMENT_PANEL_PADDING,
    paddingTop: MANAGEMENT_PANEL_PADDING,
    overflow: 'hidden',
    shadowColor: '#0EA5E9',
    shadowOpacity: 0.08,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    marginBottom: MANAGEMENT_HEADER_GAP,
  },
  headerIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
    marginTop: 2,
  },
  headerCopy: {
    flex: 1,
    gap: 4,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: '800',
    lineHeight: 24,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '500',
  },
});
