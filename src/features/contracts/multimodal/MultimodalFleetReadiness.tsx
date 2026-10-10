import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { colors } from '../../../theme';
import type { RailOfferCardViewModel } from '../../../domain/presentation/multimodalRailOfferPresentation';

interface MultimodalFleetReadinessProps {
  viewModel: RailOfferCardViewModel;
}

export default function MultimodalFleetReadiness({ viewModel }: MultimodalFleetReadinessProps) {
  const tone =
    viewModel.visualState === 'FLEET_PREPARATION_REQUIRED'
      ? colors.amber
      : viewModel.visualState === 'UNAVAILABLE'
        ? colors.danger
        : colors.success;

  return (
    <View style={styles.wrap} accessibilityRole="text">
      <Text style={[styles.summary, { color: tone }]}>{viewModel.readinessLabel}</Text>
      <Text style={styles.line}>{viewModel.originReadinessText}</Text>
      <Text style={styles.line}>{viewModel.destinationReadinessText}</Text>
      {viewModel.extraReadinessText ? (
        <Text style={styles.line}>{viewModel.extraReadinessText}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 4,
    minWidth: 0,
  },
  summary: {
    fontSize: 13,
    fontWeight: '800',
  },
  line: {
    fontSize: 12,
    color: colors.textSecondary,
    lineHeight: 17,
  },
});
