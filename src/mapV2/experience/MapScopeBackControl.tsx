/**
 * Map-scope back control. It sits on the map viewport, not the command rail.
 * WORLD renders nothing. COUNTRY returns to Dünya. CITY_DETAIL returns to the open country.
 */
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { GameIcon } from '../../components/ui';
import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { mapUiTheme } from '../../components/map/commandCenter/mapUiTheme';
import { resolveCountryDisplayName } from '../presentation/countryDisplayName';
import { resolveMapScopeBack } from '../gameplay/mapV2ExperienceNavigation';
import type { MapV2GeographicExperience } from './useMapV2GeographicExperience';

type Props = {
  experience: MapV2GeographicExperience;
};

export default function MapScopeBackControl({ experience }: Props) {
  const countryDisplayName = experience.focusRecord
    ? resolveCountryDisplayName(experience.focusRecord, 'tr')
    : null;
  const back = resolveMapScopeBack({
    mode: experience.mode,
    countryDisplayName,
  });
  if (!back.available) return null;

  return (
    <View style={styles.anchor} pointerEvents="box-none">
      <Pressable
        style={styles.button}
        onPress={() => {
          experience.goBackInMapScope();
        }}
        accessibilityRole="button"
        accessibilityLabel={back.label}
        hitSlop={8}
      >
        <GameIcon name="back" size={16} color={mapUiTheme.cyanPrimary} />
        <Text style={styles.label} numberOfLines={1}>
          {back.label}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  anchor: {
    position: 'absolute',
    top: mapUiTheme.space8,
    left: mapUiTheme.space8,
    zIndex: 2,
    alignSelf: 'flex-start',
  },
  button: {
    minHeight: MIN_TOUCH_TARGET,
    minWidth: MIN_TOUCH_TARGET,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: mapUiTheme.space4,
    paddingHorizontal: mapUiTheme.space8,
    backgroundColor: mapUiTheme.surfaceGlass,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: mapUiTheme.borderStrong,
    borderRadius: mapUiTheme.smallRadius,
  },
  label: {
    color: mapUiTheme.textPrimary,
    fontSize: 13,
    fontWeight: '700',
  },
});
