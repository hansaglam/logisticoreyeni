import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ScrollView,
} from 'react-native';
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
import { resolveManagementPanelHeight } from './managementLayout';
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
  const scrollRef = useRef<ScrollView>(null);
  const tapLockRef = useRef(false);
  const lastLoggedHeightRef = useRef(0);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const panelContentWidth =
    windowWidth - spacing.lg * 2 - MANAGEMENT_PANEL_PADDING * 2;

  const availableHeight =
    windowHeight * MANAGEMENT_PANEL_MAX_HEIGHT_RATIO - Math.max(insets.top, 0) * 0.15;

  const layout = useMemo(
    () =>
      resolveManagementPanelHeight({
        itemCount: items.length,
        availableHeight,
      }),
    [availableHeight, items.length],
  );

  const { panelHeight, naturalHeight, needsScroll } = layout;
  const listBottomInset = spacing.sm;

  useEffect(() => {
    if (!visible) {
      return;
    }
    scrollRef.current?.scrollTo({ y: 0, animated: false });
    tapLockRef.current = false;

    if (typeof __DEV__ !== 'undefined' && __DEV__) {
      console.info('[management-panel-layout]', {
        visible: true,
        windowHeight,
        bottomOffset,
        availableHeight,
        naturalPanelHeight: naturalHeight,
        panelHeight,
        needsScroll,
        itemCount: items.length,
        rowCount: layout.rowCount,
        zIndex: 'modal',
        parentOverflow: 'modal-root',
      });
    }
  }, [availableHeight, bottomOffset, items.length, layout.rowCount, naturalHeight, needsScroll, panelHeight, visible, windowHeight]);

  const handlePanelLayout = useCallback(
    (height: number) => {
      if (typeof __DEV__ === 'undefined' || !__DEV__ || !visible) {
        return;
      }
      if (Math.abs(lastLoggedHeightRef.current - height) < 1) {
        return;
      }
      lastLoggedHeightRef.current = height;
      console.info('[management-panel-layout]', {
        panelMeasuredHeight: height,
        contentMeasuredHeight: naturalHeight,
        flatListMeasuredHeight: height - MANAGEMENT_PANEL_PADDING * 2,
      });
    },
    [naturalHeight, visible],
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

  const listHeader = (
    <View style={styles.header}>
      <View style={styles.headerIconWrap}>
        <GameIcon name="quickAccess" size={16} color={colors.info} />
      </View>
      <View style={styles.headerCopy}>
        <Text style={styles.title}>Yönetim</Text>
        <Text style={styles.subtitle}>Şirketini, filonu ve operasyonlarını yönet</Text>
      </View>
    </View>
  );

  if (!visible) {
    return null;
  }

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
              onLayout={(event) => handlePanelLayout(event.nativeEvent.layout.height)}
              style={[
                styles.panel,
                {
                  height: panelHeight,
                  maxHeight: availableHeight,
                },
              ]}
              accessibilityViewIsModal
            >
              <ManagementGrid
                scrollRef={scrollRef}
                items={items}
                contentWidth={panelContentWidth}
                onItemPress={handleItemPress}
                listHeaderComponent={listHeader}
                contentBottomPadding={listBottomInset}
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
    zIndex: 20,
    elevation: 20,
  },
  panelPressable: {
    width: '100%',
    alignSelf: 'stretch',
  },
  panel: {
    width: '100%',
    backgroundColor: colors.surface2,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: 'rgba(56, 129, 200, 0.28)',
    paddingHorizontal: MANAGEMENT_PANEL_PADDING,
    paddingTop: MANAGEMENT_PANEL_PADDING,
    paddingBottom: MANAGEMENT_PANEL_PADDING,
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
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(56, 189, 248, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(56, 189, 248, 0.22)',
    marginTop: 1,
  },
  headerCopy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.sectionTitle,
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: '800',
    lineHeight: 22,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '500',
  },
});
