/**
 * Internal Testing backend tanılama paneli.
 * UID / token / API key göstermez.
 */

import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import {
  getBackendDiagnosticsSnapshot,
  isBackendDiagnosticsEnabled,
  subscribeBackendDiagnostics,
  type BackendDiagEntry,
  type BackendDiagnosticsSnapshot,
} from '../services/backendDiagnostics';
import { colors, spacing, typography } from '../theme';
import { AppCard, SectionTitle } from './ui';

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
      <SectionTitle title="Backend Tanılama" />
      <Text style={styles.hint}>Internal Testing — gizli değer gösterilmez</Text>
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
      <DiagRow label="Google sign-in" value={formatEntry(snapshot.googleSignIn)} />
      <DiagRow
        label="Marketplace callable"
        value={formatEntry(snapshot.marketplaceCallable)}
      />
      <DiagRow label="Region" value={snapshot.region} />
      <DiagRow label="App Check" value={snapshot.appCheck} />
    </AppCard>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  hint: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.xs,
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
