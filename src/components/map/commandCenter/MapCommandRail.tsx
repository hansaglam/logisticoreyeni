import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { MIN_TOUCH_TARGET } from '../../../constants/layout';
import { GameIcon } from '../../ui';
import {
  MAP_COMMAND_MODE_DEFINITIONS,
  type MapCommandMode,
  type MapCommandModeDefinition,
} from './mapCommandMode';
import { mapUiTheme } from './mapUiTheme';

interface MapCommandRailProps {
  mode: MapCommandMode;
  width: number;
  showLabels: boolean;
  showStatus: boolean;
  onModeChange: (mode: MapCommandMode) => void;
  onExit: () => void;
}

function MapCommandRail({
  mode,
  width,
  showLabels,
  showStatus,
  onModeChange,
  onExit,
}: MapCommandRailProps) {
  const operations = MAP_COMMAND_MODE_DEFINITIONS.filter((item) => item.section === 'operations');
  const transport = MAP_COMMAND_MODE_DEFINITIONS.filter((item) => item.section === 'transport');

  return (
    <View style={[styles.rail, { width }]}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Pressable
          style={styles.item}
          onPress={onExit}
          accessibilityRole="button"
          accessibilityLabel="Ana sayfaya dön"
        >
          <GameIcon name="back" size={18} color={mapUiTheme.textSecondary} />
          {showLabels ? <Text style={styles.label}>Ana</Text> : null}
        </Pressable>
        <RailSection
          title="OPERASYON"
          showTitle={showLabels}
          showStatus={showStatus}
          items={operations}
          mode={mode}
          onModeChange={onModeChange}
        />
        <RailSection
          title="TAŞIMA"
          showTitle={showLabels}
          showStatus={showStatus}
          items={transport}
          mode={mode}
          onModeChange={onModeChange}
        />
      </ScrollView>
    </View>
  );
}

function RailSection({
  title,
  showTitle,
  showStatus,
  items,
  mode,
  onModeChange,
}: {
  title: string;
  showTitle: boolean;
  showStatus: boolean;
  items: readonly MapCommandModeDefinition[];
  mode: MapCommandMode;
  onModeChange: (mode: MapCommandMode) => void;
}) {
  return (
    <View style={styles.section}>
      {showTitle ? (
        <Text style={styles.sectionTitle} pointerEvents="none">
          {title}
        </Text>
      ) : null}
      {items.map((item) => {
        const locked = item.availability === 'locked';
        const selected = mode === item.mode;
        const accent =
          item.mode === 'road'
            ? mapUiTheme.roadColor
            : item.mode === 'rail'
              ? mapUiTheme.railColor
              : mapUiTheme.cyanPrimary;
        return (
          <Pressable
            key={item.mode}
            style={[styles.item, selected && styles.itemSelected]}
            disabled={locked}
            onPress={() => {
              if (locked) return;
              onModeChange(item.mode);
            }}
            accessibilityRole="button"
            accessibilityLabel={item.accessibilityLabel}
            accessibilityState={{ selected, disabled: locked }}
          >
            {selected ? <View style={[styles.accent, { backgroundColor: accent }]} pointerEvents="none" /> : null}
            <GameIcon
              name={item.icon}
              size={18}
              color={locked ? mapUiTheme.textMuted : selected ? accent : mapUiTheme.textSecondary}
            />
            {showTitle ? (
              <Text style={[styles.label, selected && styles.labelSelected, locked && styles.labelLocked]} numberOfLines={1}>
                {item.label}
              </Text>
            ) : null}
            {item.availability === 'foundation' && showStatus ? (
              <Text style={styles.foundation} pointerEvents="none">
                TEMEL
              </Text>
            ) : null}
            {locked && showStatus ? (
              <Text style={styles.foundation} pointerEvents="none">
                KAPALI
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

export default React.memo(MapCommandRail);

const styles = StyleSheet.create({
  rail: {
    alignSelf: 'stretch',
    minHeight: 0,
    backgroundColor: mapUiTheme.surface,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: mapUiTheme.border,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingVertical: mapUiTheme.space4,
  },
  section: {
    marginTop: mapUiTheme.space4,
  },
  sectionTitle: {
    color: mapUiTheme.textMuted,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.6,
    paddingHorizontal: mapUiTheme.space8,
    marginBottom: mapUiTheme.space2,
  },
  item: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    flexDirection: 'row',
    alignItems: 'center',
    gap: mapUiTheme.space4,
    paddingHorizontal: mapUiTheme.space8,
  },
  itemSelected: {
    backgroundColor: 'rgba(61, 220, 255, 0.08)',
  },
  accent: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 2,
  },
  label: {
    color: mapUiTheme.textSecondary,
    fontSize: 11,
    fontWeight: '700',
    flexShrink: 1,
  },
  labelSelected: {
    color: mapUiTheme.textPrimary,
  },
  labelLocked: {
    color: mapUiTheme.textMuted,
  },
  foundation: {
    color: mapUiTheme.textMuted,
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
});
