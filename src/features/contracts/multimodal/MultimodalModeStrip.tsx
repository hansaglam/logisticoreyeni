import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../../../components/ui';
import { colors } from '../../../theme';
import type { RailOfferModeStage } from '../../../domain/presentation/multimodalRailOfferPresentation';

const RAIL_STEEL = '#8BA3B8';

interface MultimodalModeStripProps {
  stages: readonly RailOfferModeStage[];
  accessibleLabel: string;
  compact?: boolean;
}

function stageIcon(mode: RailOfferModeStage['mode']): 'truck' | 'train' {
  return mode === 'RAIL' ? 'train' : 'truck';
}

export default function MultimodalModeStrip({
  stages,
  accessibleLabel,
  compact = false,
}: MultimodalModeStripProps) {
  return (
    <View
      style={[styles.row, compact && styles.rowCompact]}
      accessibilityRole="text"
      accessibilityLabel={accessibleLabel}
    >
      {stages.map((stage, index) => (
        <React.Fragment key={stage.key}>
          {index > 0 ? (
            <Text style={styles.arrow} accessible={false}>
              →
            </Text>
          ) : null}
          <View style={styles.stage}>
            <GameIcon
              name={stageIcon(stage.mode)}
              size={compact ? 12 : 14}
              color={stage.mode === 'RAIL' ? RAIL_STEEL : colors.info}
            />
            <Text style={[styles.label, compact && styles.labelCompact]} numberOfLines={1}>
              {stage.label}
            </Text>
          </View>
        </React.Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 4,
    minWidth: 0,
  },
  rowCompact: {
    gap: 2,
  },
  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minWidth: 0,
    paddingVertical: 2,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textSecondary,
  },
  labelCompact: {
    fontSize: 10,
  },
  arrow: {
    fontSize: 11,
    color: colors.textMuted,
    paddingHorizontal: 2,
  },
});
