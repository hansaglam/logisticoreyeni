import React, { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  SPIKE_MARKER_COUNT_OPTIONS,
  SPIKE_ROUTE_COUNT_OPTIONS,
} from './spikeSyntheticData';

export type MapV2SpikeControlsProps = {
  markerCount: number;
  routeCount: number;
  animationPaused: boolean;
  showLayers: { regions: boolean; routes: boolean; markers: boolean; labels: boolean; vehicle: boolean };
  qualityEffects: boolean;
  cullEnabled: boolean;
  reduceMotion: boolean;
  selectedLabel: string;
  visibleMarkers: number;
  totalMarkers: number;
  screenRenderCount: number;
  canvasMountKey: number;
  onMarkerCount: (n: number) => void;
  onRouteCount: (n: number) => void;
  onTogglePause: () => void;
  onToggleLayer: (key: keyof MapV2SpikeControlsProps['showLayers']) => void;
  onToggleEffects: () => void;
  onToggleCull: () => void;
  onToggleReduceMotion: () => void;
  onResetCamera: () => void;
  onRemountCanvas: () => void;
};

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive]}
    >
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </Pressable>
  );
}

function MapV2SpikeControlsInner(props: MapV2SpikeControlsProps) {
  return (
    <View style={styles.wrap}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Chip label="Reset cam" onPress={props.onResetCamera} />
        <Chip
          label={props.animationPaused ? 'Resume' : 'Pause'}
          active={!props.animationPaused}
          onPress={props.onTogglePause}
        />
        <Chip label={`Remount (${props.canvasMountKey})`} onPress={props.onRemountCanvas} />
        <Chip label={props.cullEnabled ? 'Cull ON' : 'Cull OFF'} active={props.cullEnabled} onPress={props.onToggleCull} />
        <Chip
          label={props.qualityEffects ? 'Halo ON' : 'Halo OFF'}
          active={props.qualityEffects}
          onPress={props.onToggleEffects}
        />
        <Chip
          label={props.reduceMotion ? 'Reduce motion' : 'Full motion'}
          active={props.reduceMotion}
          onPress={props.onToggleReduceMotion}
        />
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {SPIKE_MARKER_COUNT_OPTIONS.map((n) => (
          <Chip key={n} label={`${n} mk`} active={props.markerCount === n} onPress={() => props.onMarkerCount(n)} />
        ))}
        {SPIKE_ROUTE_COUNT_OPTIONS.map((n) => (
          <Chip key={n} label={`${n} rt`} active={props.routeCount === n} onPress={() => props.onRouteCount(n)} />
        ))}
      </ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        {(Object.keys(props.showLayers) as (keyof typeof props.showLayers)[]).map((key) => (
          <Chip
            key={key}
            label={key}
            active={props.showLayers[key]}
            onPress={() => props.onToggleLayer(key)}
          />
        ))}
      </ScrollView>
      <Text style={styles.meta} accessibilityLiveRegion="polite">
        Visible {props.visibleMarkers}/{props.totalMarkers} · Selected {props.selectedLabel} · RN
        renders {props.screenRenderCount}
      </Text>
    </View>
  );
}

const MapV2SpikeControls = memo(MapV2SpikeControlsInner);
export default MapV2SpikeControls;

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: '#071018',
    paddingVertical: 8,
    gap: 6,
  },
  row: {
    paddingHorizontal: 12,
    gap: 8,
    alignItems: 'center',
  },
  chip: {
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  chipActive: {
    borderColor: '#38BDF8',
    backgroundColor: '#0C4A6E',
  },
  chipText: { color: '#94A3B8', fontSize: 12, fontWeight: '600' },
  chipTextActive: { color: '#E0F2FE' },
  meta: {
    color: '#64748B',
    fontSize: 11,
    paddingHorizontal: 12,
  },
});
