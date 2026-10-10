import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '../../components/ui';
import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { colors, radius, spacing, typography } from '../../theme';
import { mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';
import MapV2TransportLegend from './MapV2TransportLegend';

type Props = {
  countryTitle: string;
  statusLabel: string;
  totalCities: number;
  openCityCount: number;
  progressRatio: number;
  onCta: (action: 'cities' | 'contracts' | 'expand' | 'details') => void;
  railPreview?: boolean;
  seaPreview?: boolean;
  airPreview?: boolean;
};

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric} accessibilityRole="text">
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

export default function MapV2CountryOverviewShell({
  countryTitle,
  statusLabel,
  totalCities,
  openCityCount,
  progressRatio,
  onCta,
  railPreview = false,
  seaPreview = false,
  airPreview = false,
}: Props) {
  const cityValue = `${openCityCount} / ${totalCities}`;
  const barWidth = `${Math.round(Math.max(0, Math.min(1, progressRatio)) * 100)}%`;
  return (
    <View style={styles.sheet} accessibilityRole="summary" accessibilityLabel={`${countryTitle} özeti`}>
      <View style={styles.top}>
        <Text style={styles.title} numberOfLines={1}>
          {countryTitle}
        </Text>
        <View style={styles.status}>
          <Text style={styles.statusText} numberOfLines={1}>
            {statusLabel}
          </Text>
        </View>
      </View>
      <Text style={styles.body} numberOfLines={2}>
        {mapV2ExperienceCopy.countryOpsBody}
      </Text>
      <View style={styles.metrics}>
        <Metric label={mapV2ExperienceCopy.statCities} value={cityValue} />
        <Metric label={mapV2ExperienceCopy.tabContracts} value={mapV2ExperienceCopy.statJobsPlaceholder} />
        <Metric label={mapV2ExperienceCopy.statTransport} value={mapV2ExperienceCopy.statTransportRoad} />
      </View>
      <View style={styles.network} accessibilityRole="progressbar">
        <View style={styles.networkTop}>
          <Text style={styles.expansionLabel}>{mapV2ExperienceCopy.cityNetwork}</Text>
          <Text style={styles.expansionValue}>{cityValue}</Text>
        </View>
        <View style={styles.barTrack}>
          <View style={[styles.barFill, { width: barWidth as `${number}%` }]} />
        </View>
      </View>
      <View style={styles.expansion}>
        <Text style={styles.expansionLabel}>{mapV2ExperienceCopy.statExpansion}</Text>
        <Text style={styles.expansionValue}>{mapV2ExperienceCopy.comingSoonTitle}</Text>
      </View>
      <MapV2TransportLegend railPreview={railPreview} seaPreview={seaPreview} airPreview={airPreview} />
      <View style={styles.ctaCol}>
        <ActionButton
          label={mapV2ExperienceCopy.ctaViewCities}
          onPress={() => onCta('cities')}
          icon="city"
          compact
          fullWidth
          style={styles.ctaPrimary}
        />
        <View style={styles.ctaRow}>
          <ActionButton
            label={mapV2ExperienceCopy.ctaCountryDetails}
            onPress={() => onCta('details')}
            icon="map"
            variant="secondary"
            compact
            style={styles.ctaSecondary}
          />
          <ActionButton
            label={mapV2ExperienceCopy.ctaExpandNetwork}
            onPress={() => onCta('expand')}
            icon="upgrade"
            variant="secondary"
            disabled
            compact
            style={styles.ctaSecondary}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  title: { ...typography.sectionTitle, color: colors.textPrimary, flexShrink: 1 },
  status: {
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.accentBlueSoft,
  },
  statusText: { ...typography.caption, color: colors.primaryLight, fontWeight: '700' },
  body: { ...typography.bodySmall, color: colors.textSecondary },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  metric: {
    flexGrow: 1,
    flexBasis: 88,
    minWidth: 80,
    backgroundColor: colors.surface2,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  metricValue: { ...typography.dashboardMetricValue, fontSize: 16, lineHeight: 20 },
  metricLabel: { ...typography.dashboardMetricLabel },
  expansion: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
  },
  expansionLabel: { ...typography.caption, color: colors.textMuted },
  expansionValue: { ...typography.caption, color: colors.textDisabled },
  network: { gap: 4 },
  networkTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  barTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surface2,
    overflow: 'hidden',
  },
  barFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryLight,
  },
  ctaCol: { gap: spacing.xs },
  ctaPrimary: { minHeight: MIN_TOUCH_TARGET },
  ctaRow: { flexDirection: 'row', gap: spacing.xs },
  ctaSecondary: { flex: 1, minHeight: MIN_TOUCH_TARGET },
});
