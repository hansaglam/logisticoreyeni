import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

import { marketAlertBalance } from '../config/balance';
import {
  MARKET_OS_NOTIFICATIONS_ENABLED,
  osNotificationIdentifier,
  type OsGameplayNotificationPayload,
  type OsGameplayNotificationSpec,
  type OsNotificationChannelId,
} from '../domain/osNotifications';
import {
  buildReminderNotificationMessage,
  estimateReminderDelayMinutes,
} from '../utils/marketAlerts';
import { getCityName, getProductName } from '../utils/entityLookup';
import type { MarketPriceAlert } from '../types/game';

export const MARKET_ALERT_NOTIFICATION_TYPE = 'market_alert';
export const FLEET_RENTAL_NOTIFICATION_TYPE = 'fleet_rental';
export { MARKET_OS_NOTIFICATIONS_ENABLED };

let handlerConfigured = false;
let gameplayPermissionPromptedThisSession = false;

const ANDROID_CHANNELS: Record<
  OsNotificationChannelId | 'market-alerts',
  { name: string; importance: Notifications.AndroidImportance }
> = {
  'critical-operations': {
    name: 'Kritik Operasyonlar',
    importance: Notifications.AndroidImportance.HIGH,
  },
  deliveries: {
    name: 'Teslimatlar',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  'fleet-updates': {
    name: 'Filo Güncellemeleri',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  'progress-rewards': {
    name: 'İlerleme ve Ödüller',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
  'market-alerts': {
    name: 'Piyasa Alarmları',
    importance: Notifications.AndroidImportance.DEFAULT,
  },
};

function isAppForegrounded(): boolean {
  return AppState.currentState === 'active';
}

export function setupNotificationHandler(): void {
  if (handlerConfigured) return;
  handlerConfigured = true;

  Notifications.setNotificationHandler({
    handleNotification: async () => {
      const foreground = isAppForegrounded();
      return {
        shouldShowAlert: !foreground,
        shouldPlaySound: !foreground,
        shouldSetBadge: false,
        shouldShowBanner: !foreground,
        shouldShowList: !foreground,
      };
    },
  });
}

export async function ensureAndroidNotificationChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Promise.all(
    (Object.entries(ANDROID_CHANNELS) as Array<
      [keyof typeof ANDROID_CHANNELS, (typeof ANDROID_CHANNELS)[keyof typeof ANDROID_CHANNELS]]
    >).map(([id, config]) =>
      Notifications.setNotificationChannelAsync(id, {
        name: config.name,
        importance: config.importance,
        vibrationPattern: id === 'critical-operations' ? [0, 250, 180, 250] : [0, 200, 200, 200],
        lightColor: id === 'critical-operations' ? '#DC2626' : '#0EA5E9',
      }),
    ),
  );
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

/** Tick/event paths must not prompt. First delivery start is the contextual ask. */
export async function maybeRequestGameplayNotificationPermission(alreadyAsked: boolean): Promise<{
  granted: boolean;
  asked: boolean;
}> {
  setupNotificationHandler();
  await ensureAndroidNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) {
    return { granted: true, asked: alreadyAsked };
  }
  if (alreadyAsked || gameplayPermissionPromptedThisSession || current.canAskAgain === false) {
    return { granted: false, asked: alreadyAsked || current.canAskAgain === false };
  }
  gameplayPermissionPromptedThisSession = true;
  const requested = await Notifications.requestPermissionsAsync();
  return { granted: requested.granted, asked: true };
}

export async function scheduleMarketAlertNotification(
  alert: MarketPriceAlert,
  currentPrice: number,
): Promise<string | null> {
  if (!MARKET_OS_NOTIFICATIONS_ENABLED) {
    return null;
  }
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
  if (!MARKET_OS_NOTIFICATIONS_ENABLED) {
    return;
  }
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
  if (typeof __DEV__ === 'undefined' || !__DEV__) {
    throw new Error('Test bildirimi yalnız geliştirme derlemesinde kullanılabilir.');
  }
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

export function isFleetRentalNotificationResponse(
  response: Notifications.NotificationResponse,
): boolean {
  return response.notification.request.content.data?.type === FLEET_RENTAL_NOTIFICATION_TYPE;
}

export function getGameplayNotificationOpenFromResponse(
  response: Notifications.NotificationResponse,
): OsGameplayNotificationPayload | null {
  const data = response.notification.request.content.data;
  if (!data || typeof data.type !== 'string') {
    return null;
  }
  if (data.type === MARKET_ALERT_NOTIFICATION_TYPE) {
    return null;
  }
  return data as OsGameplayNotificationPayload;
}

export async function emitOsGameplayNotification(
  spec: OsGameplayNotificationSpec,
  options?: { allowWhenForeground?: boolean },
): Promise<boolean> {
  try {
    setupNotificationHandler();
    if (isAppForegrounded() && !options?.allowWhenForeground) {
      return false;
    }
    const permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      return false;
    }
    await ensureAndroidNotificationChannel();
    await Notifications.scheduleNotificationAsync({
      identifier: osNotificationIdentifier(spec.dedupeKey),
      content: {
        title: spec.title,
        body: spec.body,
        data: spec.data,
        sound: true,
        ...(Platform.OS === 'android' ? { channelId: spec.channelId } : {}),
      },
      trigger: null,
    });
    return true;
  } catch (error) {
    if (__DEV__) {
      console.warn('[os-notification] emit failed', error);
    }
    return false;
  }
}

export async function sendFleetRentalLocalNotification(input: {
  notificationId: string;
  title: string;
  body: string;
  truckId: string;
}): Promise<void> {
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    return;
  }
  if (isAppForegrounded()) {
    return;
  }

  await ensureAndroidNotificationChannel();
  await Notifications.scheduleNotificationAsync({
    identifier: input.notificationId,
    content: {
      title: input.title,
      body: input.body,
      data: {
        type: FLEET_RENTAL_NOTIFICATION_TYPE,
        truckId: input.truckId,
        notificationId: input.notificationId,
        tab: 'fleet',
      },
      sound: true,
      ...(Platform.OS === 'android' ? { channelId: 'fleet-updates' } : {}),
    },
    trigger: null,
  });
}

export function getDefaultAlertExpiryTime(currentTime: number): number {
  return currentTime + marketAlertBalance.defaultExpiryGameHours;
}
