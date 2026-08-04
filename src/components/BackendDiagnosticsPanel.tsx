/**
 * Internal Testing backend tanılama paneli.
 * UID / token / API key göstermez.
 * Varsayılan kapalı accordion — production store'da tamamen gizli.
 */

import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getBackendDiagnosticsSnapshot,
  isBackendDiagnosticsEnabled,
  subscribeBackendDiagnostics,
  type BackendDiagEntry,
  type BackendDiagnosticsSnapshot,
} from '../services/backendDiagnostics';
import { colors, spacing, typography } from '../theme';
import { AppCard } from './ui';

function formatEntry(entry: BackendDiagEntry): string {
  if (entry.status === 'idle') return 'idle';
  if (entry.status === 'pending') return 'pending';
  if (entry.status === 'ok') return entry.code ? `ok (${entry.code})` : 'ok';
  if (entry.status === 'skipped') {
    return entry.code ? `skipped (${entry.code})` : 'skipped';
  }
  return entry.code ? `failed (${entry.code})` : 'failed';
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function BackendDiagnosticsPanel() {
  const [snapshot, setSnapshot] = useState<BackendDiagnosticsSnapshot>(
    getBackendDiagnosticsSnapshot,
  );
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!isBackendDiagnosticsEnabled()) return;
    setSnapshot(getBackendDiagnosticsSnapshot());
    return subscribeBackendDiagnostics(() => {
      setSnapshot(getBackendDiagnosticsSnapshot());
    });
  }, []);

  if (!isBackendDiagnosticsEnabled()) {
    return null;
  }

  return (
    <AppCard style={styles.card}>
      <Pressable
        onPress={() => setExpanded((open) => !open)}
        style={styles.header}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        <Text style={styles.headerTitle}>Geliştirici Araçları</Text>
        <Text style={styles.chevron}>{expanded ? '▾' : '▸'}</Text>
      </Pressable>
      {expanded ? (
        <View style={styles.body}>
          <Text style={styles.hint}>Backend Tanılama — gizli değer gösterilmez</Text>
          <DiagRow label="Project" value={snapshot.projectId} />
          <DiagRow
            label="Auth initialized"
            value={snapshot.authInitialized ? 'yes' : 'no'}
          />
          <DiagRow label="Auth ready" value={snapshot.authReady ? 'yes' : 'no'} />
          <DiagRow label="Current user" value={snapshot.currentUserKind} />
          <DiagRow
            label="Anonymous sign-in"
            value={formatEntry(snapshot.anonymousSignIn)}
          />
          <DiagRow
            label="Global economy"
            value={formatEntry(snapshot.globalEconomy)}
          />
          <DiagRow
            label="Economy document"
            value={
              snapshot.globalEconomyDetails.documentExists == null
                ? 'unknown'
                : snapshot.globalEconomyDetails.documentExists
                  ? 'exists'
                  : 'missing'
            }
          />
          <DiagRow
            label="Economy validation"
            value={
              snapshot.globalEconomyDetails.validationPassed == null
                ? 'unknown'
                : snapshot.globalEconomyDetails.validationPassed
                  ? 'valid'
                  : 'invalid'
            }
          />
          <DiagRow label="Economy source" value={snapshot.globalEconomyDetails.source} />
          <DiagRow
            label="Snapshot age"
            value={
              snapshot.globalEconomyDetails.snapshotAgeMs == null
                ? 'n/a'
                : `${Math.round(snapshot.globalEconomyDetails.snapshotAgeMs / 60_000)} min`
            }
          />
          <DiagRow
            label="Fuel price finite"
            value={
              snapshot.globalEconomyDetails.fuelPriceFinite == null
                ? 'unknown'
                : snapshot.globalEconomyDetails.fuelPriceFinite
                  ? 'yes'
                  : 'no'
            }
          />
          <DiagRow
            label="Economy cache"
            value={
              snapshot.globalEconomyDetails.cacheAvailable
                ? `yes (${Math.round((snapshot.globalEconomyDetails.cacheAgeMs ?? 0) / 60_000)} min)`
                : 'no'
            }
          />
          <DiagRow label="Google sign-in" value={formatEntry(snapshot.googleSignIn)} />
          <DiagRow
            label="Marketplace callable"
            value={formatEntry(snapshot.marketplaceCallable)}
          />
          <DiagRow label="Region" value={snapshot.region} />
          <DiagRow label="App Check" value={snapshot.appCheck} />
          <Text style={[styles.hint, styles.adsSection]}>Reklam (AdMob)</Text>
          <DiagRow label="Ads enabled" value={snapshot.ads.adsEnabled ? 'yes' : 'no'} />
          <DiagRow label="SDK initialized" value={snapshot.ads.sdkInitialized ? 'yes' : 'no'} />
          <DiagRow
            label="App ID configured"
            value={snapshot.ads.appIdConfigured ? 'yes' : 'no'}
          />
          <DiagRow
            label="Unit configured"
            value={snapshot.ads.platformUnitConfigured ? 'yes' : 'no'}
          />
          <DiagRow label="Test ID active" value={snapshot.ads.testIdActive ? 'yes' : 'no'} />
          <DiagRow label="Ads mode" value={snapshot.ads.mode} />
          <DiagRow label="Lifecycle" value={snapshot.ads.lifecycle} />
          <DiagRow label="Rewarded loaded" value={snapshot.ads.rewardedLoaded ? 'yes' : 'no'} />
          <DiagRow
            label="Last error"
            value={snapshot.ads.lastErrorCategory ?? 'none'}
          />
          <DiagRow
            label="Last reward"
            value={snapshot.ads.lastRewardEvent ?? 'none'}
          />
          <DiagRow
            label="Adapters"
            value={
              snapshot.ads.adapterCount == null ? 'n/a' : String(snapshot.ads.adapterCount)
            }
          />
        </View>
      ) : null}
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.sm,
    gap: 0,
    paddingVertical: spacing.sm,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xs,
  },
  headerTitle: {
    ...typography.caption,
    color: colors.textMuted,
    fontWeight: '700',
  },
  chevron: {
    color: colors.textMuted,
    fontSize: 14,
  },
  body: {
    marginTop: spacing.sm,
    gap: spacing.xs,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
  },
  adsSection: {
    marginTop: spacing.sm,
    fontWeight: '700',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingVertical: 2,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    flexShrink: 0,
  },
  value: {
    ...typography.caption,
    color: colors.textPrimary,
    textAlign: 'right',
    flex: 1,
  },
});
