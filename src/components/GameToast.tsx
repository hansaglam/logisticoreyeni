/**
 * LogistiCore - Global oyun bildirimi (toast)
 *
 * Store'daki en son notification'ı gösterir; auto-dismiss ve aksiyon destekler.
 */

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useAppSafeAreaInsets } from './AppSafeAreaProvider';
import { STATUS_BAR_HEIGHT, UI } from '../theme/ui';
import { useGameStore } from '../store/gameStore';
import type { GameNotification, GameNotificationType } from '../types/game';
import { resolveNotificationDismissMs } from '../types/game';

const TYPE_COLORS: Record<GameNotificationType, string> = {
  success: '#22C55E',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#38BDF8',
};

function getAccentColor(type: GameNotificationType): string {
  return TYPE_COLORS[type] ?? TYPE_COLORS.info;
}

interface ToastCardProps {
  notification: GameNotification;
  onDismiss: () => void;
  onAction?: () => void;
}

function ToastCard({ notification, onDismiss, onAction }: ToastCardProps) {
  const accent = getAccentColor(notification.type);

  return (
    <Pressable style={[styles.card, { borderLeftColor: accent }]} onPress={onDismiss}>
      <View style={styles.content}>
        <Text style={styles.title}>{notification.title}</Text>
        <Text style={styles.message}>{notification.message}</Text>
        {notification.actionLabel && onAction ? (
          <TouchableOpacity style={styles.actionButton} onPress={onAction} activeOpacity={0.85}>
            <Text style={[styles.actionText, { color: accent }]}>{notification.actionLabel}</Text>
          </TouchableOpacity>
        ) : null}
      </View>
      <TouchableOpacity
        style={styles.closeButton}
        onPress={onDismiss}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        <Text style={styles.closeText}>×</Text>
      </TouchableOpacity>
    </Pressable>
  );
}

export default function GameToast() {
  const notification = useGameStore((state) => state.notifications[0]);
  const dismissNotification = useGameStore((state) => state.dismissNotification);
  const requestNavigationFromNotification = useGameStore(
    (state) => state.requestNavigationFromNotification,
  );
  const openMarketFromAlert = useGameStore((state) => state.openMarketFromAlert);
  const insets = useAppSafeAreaInsets();

  useEffect(() => {
    if (!notification) return undefined;

    const duration = resolveNotificationDismissMs(notification.type, notification.autoDismissMs);
    const timeout = setTimeout(() => {
      dismissNotification(notification.id);
    }, duration);

    return () => clearTimeout(timeout);
  }, [notification?.id, dismissNotification]);

  if (!notification) {
    return null;
  }

  const topOffset = Math.max(insets.top, STATUS_BAR_HEIGHT) + 12;

  const handleAction = () => {
    if (notification.actionTarget === 'market' && notification.marketFocus) {
      openMarketFromAlert(notification.marketFocus);
    } else if (notification.actionTarget) {
      requestNavigationFromNotification(notification.actionTarget);
    }
    dismissNotification(notification.id);
  };

  return (
    <View style={[styles.container, { top: topOffset }]} pointerEvents="box-none">
      <ToastCard
        notification={notification}
        onDismiss={() => dismissNotification(notification.id)}
        onAction={notification.actionLabel ? handleAction : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 999,
  },
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: UI.colors.card,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: UI.colors.border,
    borderLeftWidth: 4,
    paddingVertical: 12,
    paddingLeft: 14,
    paddingRight: 8,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  content: {
    flex: 1,
    paddingRight: 4,
  },
  title: {
    color: UI.colors.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 4,
  },
  message: {
    color: UI.colors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  actionButton: {
    alignSelf: 'flex-start',
    marginTop: 8,
    paddingVertical: 2,
  },
  actionText: {
    fontSize: 12,
    fontWeight: '800',
  },
  closeButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    color: UI.colors.textMuted,
    fontSize: 22,
    lineHeight: 22,
    fontWeight: '300',
  },
});
