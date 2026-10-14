import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MARKET_ALARMS_ENABLED } from '../../../config/backendRoadmap';
import { useEffectiveCompanyProgression } from '../../../hooks/useEffectiveCompanyProgression';
import { useGameStore } from '../../../store/gameStore';
import {
  selectPlayerCompanyName,
  selectPlayerMoney,
} from '../../../store/selectors/playerFields';
import { formatLiveEconomyCompact, formatMoney } from '../../../theme/format';
import { countActiveMarketAlerts } from '../../../utils/marketAlerts';
import { GameIcon } from '../../ui';
import { mapUiTheme } from './mapUiTheme';

interface MapTopStatusBarProps {
  helpSlot?: React.ReactNode;
  showCompanyName: boolean;
}

function MapTopStatusBar({ helpSlot, showCompanyName }: MapTopStatusBarProps) {
  const companyName = useGameStore(selectPlayerCompanyName);
  const money = useGameStore(selectPlayerMoney);
  const localLevel = useGameStore((state) => state.player?.level);
  const localCompanyLevel = useGameStore((state) => state.player?.companyLevel);
  const localXp = useGameStore((state) => state.player?.xp);
  const localXpToNext = useGameStore((state) => state.player?.xpToNextLevel);
  const localTotalXp = useGameStore((state) => state.player?.totalXp);
  const localReputation = useGameStore((state) => state.player?.reputation);
  const alertCount = useGameStore((state) =>
    MARKET_ALARMS_ENABLED ? countActiveMarketAlerts(state.marketAlerts ?? []) : 0,
  );
  const localProgression = useMemo(
    () => ({
      level: localLevel,
      companyLevel: localCompanyLevel,
      xp: localXp,
      xpToNextLevel: localXpToNext,
      totalXp: localTotalXp,
      reputation: localReputation,
    }),
    [localCompanyLevel, localLevel, localReputation, localTotalXp, localXp, localXpToNext],
  );
  const progression = useEffectiveCompanyProgression(localProgression);
  const progressionReady = progression.status === 'ready';
  const level = progressionReady ? progression.level : null;
  const reputation = progressionReady ? progression.reputation : null;
  const xp = progressionReady ? progression.xp : null;
  const xpToNext = progressionReady ? progression.xpToNextLevel : null;
  const showXp =
    xp != null && xpToNext != null && Number.isFinite(xp) && Number.isFinite(xpToNext) && xpToNext > 0;
  const xpRatio = showXp ? Math.max(0, Math.min(1, xp / xpToNext)) : 0;
  const economyLabel = formatLiveEconomyCompact();

  return (
    <View style={styles.bar} accessibilityRole="header">
      <View style={styles.brandBlock}>
        <View style={styles.mark} pointerEvents="none">
          <Text style={styles.markText}>LC</Text>
        </View>
        <View style={styles.brandCopy}>
          <Text style={styles.brand} numberOfLines={1}>
            LOGISTICORE
          </Text>
          {showCompanyName ? (
            <Text style={styles.company} numberOfLines={1}>
              {companyName}
            </Text>
          ) : null}
        </View>
      </View>

      <View style={styles.metrics}>
        {level != null ? (
          <View style={styles.metric}>
            <GameIcon name="level" size={12} color={mapUiTheme.cyanPrimary} />
            <Text style={styles.metricValue}>Sv {level}</Text>
          </View>
        ) : null}
        {showXp ? (
          <View style={styles.xpBlock}>
            <View style={styles.xpTrack} pointerEvents="none">
              <View style={[styles.xpFill, { width: `${xpRatio * 100}%` }]} />
            </View>
          </View>
        ) : null}
        <View style={styles.metric}>
          <GameIcon name="cash" size={12} color={mapUiTheme.greenSuccess} />
          <Text style={styles.metricValue}>{formatMoney(money)}</Text>
        </View>
        {reputation != null ? (
          <View style={styles.metric}>
            <GameIcon name="reputation" size={12} color={mapUiTheme.amberWarning} />
            <Text style={styles.metricValue}>{reputation}</Text>
          </View>
        ) : null}
        {MARKET_ALARMS_ENABLED ? (
          <View
            style={styles.metric}
            accessibilityLabel={alertCount > 0 ? `${alertCount} piyasa uyarısı` : 'Piyasa uyarısı yok'}
          >
            <GameIcon
              name="alert"
              size={12}
              color={alertCount > 0 ? mapUiTheme.amberWarning : mapUiTheme.textMuted}
            />
            <Text style={styles.metricValue}>{alertCount}</Text>
          </View>
        ) : null}
        <View style={styles.metric}>
          <GameIcon name="time" size={12} color={mapUiTheme.textMuted} />
          <Text style={styles.metricMuted} numberOfLines={1}>
            {economyLabel}
          </Text>
        </View>
        {helpSlot}
      </View>
    </View>
  );
}

export default React.memo(MapTopStatusBar);

const styles = StyleSheet.create({
  bar: {
    height: mapUiTheme.topBarHeight,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: mapUiTheme.space8,
    gap: mapUiTheme.space8,
    backgroundColor: mapUiTheme.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: mapUiTheme.border,
    overflow: 'hidden',
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: mapUiTheme.space8,
    flexShrink: 1,
    minWidth: 0,
  },
  mark: {
    width: 22,
    height: 22,
    borderRadius: mapUiTheme.smallRadius,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mapUiTheme.borderStrong,
    backgroundColor: 'rgba(61, 220, 255, 0.08)',
  },
  markText: {
    color: mapUiTheme.cyanPrimary,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.4,
  },
  brandCopy: {
    flexShrink: 1,
    minWidth: 0,
  },
  brand: {
    color: mapUiTheme.textPrimary,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.8,
  },
  company: {
    color: mapUiTheme.textMuted,
    fontSize: 10,
    fontWeight: '600',
  },
  metrics: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: mapUiTheme.space8,
    minWidth: 0,
  },
  metric: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: mapUiTheme.space4,
    flexShrink: 1,
    minWidth: 0,
  },
  metricValue: {
    color: mapUiTheme.textPrimary,
    fontSize: 12,
    fontWeight: '700',
  },
  metricMuted: {
    color: mapUiTheme.textSecondary,
    fontSize: 10,
    fontWeight: '600',
    flexShrink: 1,
  },
  xpBlock: {
    width: 56,
    justifyContent: 'center',
  },
  xpTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(154, 174, 196, 0.2)',
    overflow: 'hidden',
  },
  xpFill: {
    height: 4,
    backgroundColor: mapUiTheme.cyanPrimary,
  },
});
