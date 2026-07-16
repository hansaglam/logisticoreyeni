import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { marketAlertBalance } from '../config/balance';
import {
  buildReminderNotificationMessage,
  estimateReminderDelayMinutes,
} from '../utils/marketAlerts';
import { getCityName, getProductName } from '../utils/entityLookup';
import type { MarketPriceAlert } from '../types/game';

export const MARKET_ALERT_NOTIFICATION_TYPE = 'market_alert';

let handlerConfigured = false;

export function setupNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('market-alerts', {
    name: 'Piyasa Alarmları',
    importance: Notifications.AndroidImportance.DEFAULT,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: '#1D4ED8',
  });
}

export async function requestNotificationPermissions(): Promise<{
  granted: boolean;
  canAskAgain: boolean;
}> {
  setupNotificationHandler();
  await ensureAndroidNotificationChannel();

  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return { granted: true, canAskAgain: current.canAskAgain ?? true };
  }

  const requested = await Notifications.requestPermissionsAsync();
  return {
    granted: requested.granted,
    canAskAgain: requested.canAskAgain ?? true,
  };
}

export async function scheduleMarketAlertNotification(
  alert: MarketPriceAlert,
  currentPrice: number,
): Promise<string | null> {
  const permission = await requestNotificationPermissions();
  if (!permission.granted) {
    return null;
  }

  const delayMinutes = estimateReminderDelayMinutes(alert, currentPrice);
  const cityName = getCityName(alert.cityId);
  const productName = getProductName(alert.productId);
  const content = buildReminderNotificationMessage(alert, cityName, productName);

  const triggerDate = new Date(Date.now() + delayMinutes * 60 * 1000);
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: content.title,
      body: content.body,
      data: {
        type: MARKET_ALERT_NOTIFICATION_TYPE,
        alertId: alert.id,
        cityId: alert.cityId,
        productId: alert.productId,
      },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DATE,
      date: triggerDate,
      channelId: Platform.OS === 'android' ? 'market-alerts' : undefined,
    },
  });

  return notificationId;
}

export async function cancelMarketAlertNotification(
  notificationId: string | undefined,
): Promise<void> {
  if (!notificationId) return;
  try {
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  } catch {
    // Scheduled notification may already have fired.
  }
}

export async function sendLocalMarketAlertNotification(
  alert: MarketPriceAlert,
  message: string,
): Promise<void> {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Piyasa alarmı',
      body: message,
      data: {
        type: MARKET_ALERT_NOTIFICATION_TYPE,
        alertId: alert.id,
        cityId: alert.cityId,
        productId: alert.productId,
      },
      sound: true,
    },
    trigger: null,
  });
}

export async function sendTestMarketNotification(): Promise<void> {
  const permission = await requestNotificationPermissions();
  if (!permission.granted) {
    throw new Error('Bildirim izni verilmedi.');
  }

  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Piyasa alarmını kontrol et',
      body: 'Test bildirimi — piyasa alarmı sistemi çalışıyor.',
      data: { type: MARKET_ALERT_NOTIFICATION_TYPE, test: true },
      sound: true,
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 2,
      channelId: Platform.OS === 'android' ? 'market-alerts' : undefined,
    },
  });
}

export function addNotificationResponseListener(
  listener: (response: Notifications.NotificationResponse) => void,
): Notifications.EventSubscription {
  return Notifications.addNotificationResponseReceivedListener(listener);
}

export function getMarketAlertFocusFromResponse(
  response: Notifications.NotificationResponse,
): { cityId: string; productId: string } | null {
  const data = response.notification.request.content.data;
  if (!data || data.type !== MARKET_ALERT_NOTIFICATION_TYPE) {
    return null;
  }
  if (typeof data.cityId !== 'string' || typeof data.productId !== 'string') {
    return null;
  }
  return { cityId: data.cityId, productId: data.productId };
}

export function getDefaultAlertExpiryTime(currentTime: number): number {
  return currentTime + marketAlertBalance.defaultExpiryGameHours;
}
