/**
 * Akıllı Oyun İpuçları bandı — bağlamsal / dönen kısa rehber.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  type AppStateStatus,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  GAME_TIPS,
  getTipMessage,
  type GameTipDefinition,
  type GameTipTargetRoute,
} from '../../data/gameTips';
import { subscribeAuthState } from '../../services/authService';
import { getFirebaseAuthSafe } from '../../services/firebase';
import {
  advanceTip,
  buildSmartTipContext,
  resolveTipNavigation,
  SMART_TIP_CRITICAL_ROTATION_MS,
  SMART_TIP_ROTATION_MS,
  type SmartTipContext,
} from '../../simulation/smartGameTips';
import { useGameStore } from '../../store/gameStore';
import { radius, spacing } from '../../theme';
import { GameIcon } from '../ui';

export interface SmartGameTipBannerProps {
  dismissible?: boolean;
  onPressTip?: (target: GameTipTargetRoute | null, tip: GameTipDefinition) => void;
  /** Test / override — verilirse store yerine kullanılır. */
  contextOverride?: SmartTipContext;
  catalog?: readonly GameTipDefinition[];
  rotationMs?: number;
}

const SESSION_STARTED_AT_MS = Date.now();

function readAccountLinked(): boolean {
  const user = getFirebaseAuthSafe()?.currentUser;
  return Boolean(user && !user.isAnonymous);
}

export default function SmartGameTipBanner({
  dismissible = false,
  onPressTip,
  contextOverride,
  catalog = GAME_TIPS,
  rotationMs,
}: SmartGameTipBannerProps) {
  const player = useGameStore((state) => state.player);
  const currentTime = useGameStore((state) => state.currentTime);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries);

  const [accountLinked, setAccountLinked] = useState(readAccountLinked);
  const [dismissed, setDismissed] = useState(false);
  const [tipTick, setTipTick] = useState(0);
  const [activeTip, setActiveTip] = useState<GameTipDefinition | null>(null);
  const [isCritical, setIsCritical] = useState(false);

  const previousTipIdRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appActiveRef = useRef(AppState.currentState === 'active');
  const fade = useRef(new Animated.Value(1)).current;
  const catalogRef = useRef(catalog);
  catalogRef.current = catalog;

  const storeContext = useMemo(() => {
    if (contextOverride) return contextOverride;
    return buildSmartTipContext({
      player,
      activeDeliveries: activeDeliveries ?? [],
      currentTime,
      accountLinked,
      sessionAgeMs: Date.now() - SESSION_STARTED_AT_MS,
    });
  }, [accountLinked, activeDeliveries, contextOverride, currentTime, player]);

  const contextRef = useRef(storeContext);
  contextRef.current = storeContext;

  /** Fotoğraf — currentTime tick'lerinde gereksiz reset yok. */
  const contextKey = useMemo(
    () =>
      [
        Math.floor(storeContext.minFuelPercent / 5),
        storeContext.idleTruckCount > 0 ? 1 : 0,
        storeContext.trucksWithoutDriver > 0 ? 1 : 0,
        storeContext.warehouseFillRatio >= 0.95 ? 1 : 0,
        storeContext.hasUrgentDelivery ? 1 : 0,
        storeContext.accountLinked ? 1 : 0,
        storeContext.reputation < 40 ? 1 : 0,
        storeContext.minTruckCondition < 40 ? 1 : 0,
        storeContext.trailerCount <= 0 ? 1 : 0,
        storeContext.sessionAgeMs < 30 * 60 * 1000 ? 1 : 0,
        storeContext.money < 8000 ? 1 : 0,
      ].join('|'),
    [storeContext],
  );

  const applySelection = useCallback((previousId: string | null) => {
    const selection = advanceTip(contextRef.current, previousId, catalogRef.current);
    if (!selection) {
      setActiveTip(null);
      setIsCritical(false);
      return null;
    }
    previousTipIdRef.current = selection.tip.id;
    setActiveTip(selection.tip);
    setIsCritical(selection.isCritical);
    setTipTick((value) => value + 1);
    return selection;
  }, []);

  const animateToNext = useCallback(() => {
    Animated.timing(fade, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (!finished) return;
      applySelection(previousTipIdRef.current);
      Animated.timing(fade, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }).start();
    });
  }, [applySelection, fade]);

  useEffect(() => {
    const unsub = subscribeAuthState((user) => {
      setAccountLinked(Boolean(user && !user.isAnonymous));
    });
    setAccountLinked(readAccountLinked());
    return unsub;
  }, []);

  useEffect(() => {
    if (dismissed) return;
    applySelection(previousTipIdRef.current);
  }, [applySelection, contextKey, dismissed]);

  const clearTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearTimer();
    if (dismissed || !activeTip || !appActiveRef.current) {
      return;
    }

    const delay =
      rotationMs ??
      (isCritical ? SMART_TIP_CRITICAL_ROTATION_MS : SMART_TIP_ROTATION_MS);

    timerRef.current = setTimeout(() => {
      animateToNext();
    }, delay);

    return clearTimer;
  }, [activeTip?.id, animateToNext, clearTimer, dismissed, isCritical, rotationMs, tipTick]);

  useEffect(() => {
    const onAppState = (next: AppStateStatus) => {
      const active = next === 'active';
      appActiveRef.current = active;
      if (!active) {
        clearTimer();
      }
    };
    const sub = AppState.addEventListener('change', onAppState);
    return () => {
      sub.remove();
      clearTimer();
    };
  }, [clearTimer]);

  if (dismissed || !activeTip) {
    return null;
  }

  const message = getTipMessage(activeTip);
  const accent = isCritical ? '#FFB020' : '#39A0FF';
  const borderColor = isCritical ? 'rgba(255, 176, 32, 0.42)' : 'rgba(35, 136, 255, 0.28)';
  const backgroundColor = isCritical
    ? 'rgba(255, 170, 0, 0.08)'
    : 'rgba(35, 136, 255, 0.06)';
  const iconBg = isCritical
    ? 'rgba(255, 170, 0, 0.14)'
    : 'rgba(35, 136, 255, 0.12)';

  return (
    <Animated.View style={{ opacity: fade }}>
      <Pressable
        style={[styles.banner, { borderColor, backgroundColor }]}
        onPress={() => onPressTip?.(activeTip.targetRoute, activeTip)}
        onLongPress={
          dismissible
            ? () => {
                clearTimer();
                setDismissed(true);
              }
            : undefined
        }
        accessibilityRole="button"
        accessibilityLabel={`Oyun ipucu: ${message}`}
        accessibilityHint={
          activeTip.targetRoute ? 'İlgili ekranı açmak için dokun' : undefined
        }
      >
        <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
          <GameIcon name={activeTip.icon} size={14} color={accent} />
        </View>
        <Text style={styles.message} numberOfLines={2} ellipsizeMode="tail">
          {message}
        </Text>
        <Pressable
          onPress={() => {
            clearTimer();
            animateToNext();
          }}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Sonraki ipucu"
          style={styles.nextButton}
        >
          <GameIcon name="chevronRight" size={16} color={accent} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

/** Navigasyon yardımcı — Dashboard bağlar. */
export function navigateFromGameTip(
  target: GameTipTargetRoute | null,
  handlers: {
    navigateTab: (
      tab: NonNullable<ReturnType<typeof resolveTipNavigation>>['tab'],
    ) => void;
    openMoreSubRoute: (sub: 'warehouse' | 'finance' | 'leaderboard' | null) => void;
  },
): void {
  const nav = resolveTipNavigation(target);
  if (!nav?.tab) return;
  if (nav.tab === 'more') {
    handlers.openMoreSubRoute(nav.moreSubRoute ?? null);
    return;
  }
  handlers.navigateTab(nav.tab);
}

const styles = StyleSheet.create({
  banner: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
  },
  iconWrap: {
    width: 29,
    height: 29,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  message: {
    flex: 1,
    minWidth: 0,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: '500',
    color: '#D5DEEC',
  },
  nextButton: {
    flexShrink: 0,
    paddingLeft: 2,
  },
});
