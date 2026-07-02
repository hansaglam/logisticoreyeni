/**
 * Internal test build bilgi paneli — More ve Debug ekranlarında gösterilir.
 */

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { BACKEND_ENABLED, INTERNAL_TEST_VERSION } from '../config/backendRoadmap';
import { UI } from '../theme/ui';

interface InfoRowProps {
  label: string;
  value: string;
}

function InfoRow({ label, value }: InfoRowProps) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}

export default function InternalTestInfoPanel() {
  return (
    <View style={styles.panel}>
      <Text style={styles.title}>Internal Test</Text>
      <InfoRow label="Build type" value="Internal Test" />
      <InfoRow label="Save system" value="Local Auto Save" />
      <InfoRow label="Backend" value={BACKEND_ENABLED ? 'Enabled' : 'Disabled'} />
      <InfoRow label="Version" value={INTERNAL_TEST_VERSION} />
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: UI.colors.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: UI.colors.border,
    padding: 12,
    marginBottom: 12,
  },
  title: {
    color: UI.colors.primary,
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 4,
    gap: 12,
  },
  label: {
    color: UI.colors.textMuted,
    fontSize: 12,
    flex: 1,
  },
  value: {
    color: UI.colors.text,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
  },
});
