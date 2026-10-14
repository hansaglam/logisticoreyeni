/**
 * MAP-01 Map V2 world experience (DEV / internal).
 *
 * Back contract:
 * - COUNTRY → WORLD, restoring the previous world camera when captured
 * - WORLD with a selection → deselect
 * - WORLD with no selection → close this experience (Simülasyon Testi), not the app
 * Android hardwareBackPress follows the same stack.
 */
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';

import { useAppDialog } from '../../components/AppDialogProvider';
import { IconButton, ScreenHeader } from '../../components/ui';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, radius, spacing, typography } from '../../theme';
import MapV2ExperienceCanvas from '../experience/MapV2ExperienceCanvas';
import { useMapV2GeographicExperience } from '../experience/useMapV2GeographicExperience';
import { canEnterCountryMode } from '../gameplay/mapV2ExperienceNavigation';
import {
  selectActiveDeliveriesByCity,
  selectOwnedTrucksByCity,
  selectWarehousesByCity,
} from '../gameplay/cityOperation';
import {
  MAP_V2_CITY_PROGRESSION_DEFAULT_MODE,
  type MapV2CityProgressionMode,
} from '../gameplay/cityProgression';
import { isRailPlayerVisualPreviewEnabled } from '../gameplay/railPlayerVisual';
import { isSeaPlayerVisualPreviewEnabled } from '../gameplay/seaPlayerVisual';
import { isAirPlayerVisualPreviewEnabled } from '../gameplay/airPlayerVisual';
import { resolveCityDisplayName } from '../presentation/cityDisplayName';
import { resolveCountryDisplayName } from '../presentation/countryDisplayName';
import { mapV2ExperienceCopy } from '../presentation/mapV2ExperienceCopy';
import MapV2CityDetailScreen from './MapV2CityDetailScreen';
import MapV2CityLockPanel from './MapV2CityLockPanel';
import MapV2CitySelectionPanel from './MapV2CitySelectionPanel';
import MapV2CountryCitiesPane from './MapV2CountryCitiesPane';
import MapV2CountryHeader from './MapV2CountryHeader';
import MapV2CountryModeTabs, { type CountryModeTab } from './MapV2CountryModeTabs';
import MapV2CountryOverviewShell from './MapV2CountryOverviewShell';
import MapV2CountrySelectionPanel from './MapV2CountrySelectionPanel';

type Props = {
  onClose: () => void;
  cityProgressionMode?: MapV2CityProgressionMode;
};

export default function MapV2WorldScreen({
  onClose,
  cityProgressionMode = MAP_V2_CITY_PROGRESSION_DEFAULT_MODE,
}: Props) {
  const { contentBottomPadding } = useTabBarLayout();
  const { width: windowWidth } = useWindowDimensions();
  const compactPhone = windowWidth < 360;
  const { showDialog } = useAppDialog();
  const [progressionMode, setProgressionMode] = useState<MapV2CityProgressionMode>(cityProgressionMode);
  const [railVisualPreview, setRailVisualPreview] = useState(() => isRailPlayerVisualPreviewEnabled());
  const [seaVisualPreview, setSeaVisualPreview] = useState(() => isSeaPlayerVisualPreviewEnabled());
  const [airVisualPreview, setAirVisualPreview] = useState(() => isAirPlayerVisualPreviewEnabled());
  const experience = useMapV2GeographicExperience({
    cityProgressionMode: progressionMode,
    railVisualPreview,
    seaVisualPreview,
    airVisualPreview,
    enterCountryOnSelect: false,
    cityDetailEnabled: true,
    handleHardwareBack: true,
    onClose,
  });
  const {
    canvasRef,
    mode,
    selectedId,
    setSelectedId,
    focusCountryId,
    focusRecord,
    selected,
    availability,
    displayName,
    reduceMotion,
    selectedCityId,
    setSelectedCityId,
    countryTab,
    setCountryTab,
    animate,
    overviewCities,
    homeCityId,
    warehouses,
    trucks,
    deliveries,
    selectedCity,
    operationsByGeoCityId,
    selectedOperation,
    cityProgression,
    availabilityByGeoCityId,
    selectedCityProgression,
    selectedCityLocked,
    enterCountry,
    enterCityDetail,
    goBackInMapScope,
    gameplayCityCount,
    countryStatus,
  } = experience;

  const onPrimary = useCallback(() => {
    if (!selectedId || !availability) return;
    if (canEnterCountryMode(availability)) {
      enterCountry(selectedId);
      return;
    }
    if (availability === 'LOCKED') {
      showDialog({
        title: mapV2ExperienceCopy.requirementsTitle,
        message: mapV2ExperienceCopy.requirementsBody,
        confirmLabel: mapV2ExperienceCopy.closeSelection,
      });
    }
  }, [availability, enterCountry, selectedId, showDialog]);

  const onComingSoon = useCallback(() => {
    showDialog({
      title: mapV2ExperienceCopy.comingSoonTitle,
      message: mapV2ExperienceCopy.comingSoonBody,
      confirmLabel: mapV2ExperienceCopy.closeSelection,
    });
  }, [showDialog]);

  const onCountryDetails = useCallback(() => {
    showDialog({
      title: resolveCountryDisplayName(focusRecord, 'tr'),
      message: mapV2ExperienceCopy.countryOpsBody,
      confirmLabel: mapV2ExperienceCopy.closeSelection,
    });
  }, [focusRecord, showDialog]);

  const onCountryCta = useCallback(
    (action: 'cities' | 'contracts' | 'expand' | 'details') => {
      if (action === 'cities') {
        setCountryTab('cities');
        return;
      }
      if (action === 'details') {
        onCountryDetails();
        return;
      }
      onComingSoon();
    },
    [onComingSoon, onCountryDetails, setCountryTab],
  );

  const headerTitle = mapV2ExperienceCopy.worldTitle;
  const headerSubtitle = mapV2ExperienceCopy.worldSubtitle;

  if (mode === 'CITY_DETAIL' && selectedOperation && !selectedCityLocked) {
    return (
      <View style={[styles.root, { paddingBottom: contentBottomPadding }, compactPhone && styles.rootNarrow]}>
        <MapV2CityDetailScreen
          model={selectedOperation}
          countryTitle={resolveCountryDisplayName(focusRecord, 'tr') || mapV2ExperienceCopy.cityCountryTurkey}
          warehouses={selectWarehousesByCity(warehouses, selectedOperation.legacyCityId)}
          trucks={selectOwnedTrucksByCity(trucks, selectedOperation.legacyCityId, homeCityId)}
          deliveries={selectActiveDeliveriesByCity(deliveries, selectedOperation.legacyCityId)}
          onBack={goBackInMapScope}
          reduceMotion={reduceMotion}
        />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.root,
        { paddingBottom: contentBottomPadding },
        compactPhone && styles.rootNarrow,
        mode === 'COUNTRY' && styles.rootCountry,
      ]}
    >
      {mode === 'COUNTRY' ? (
        <MapV2CountryHeader
          title={resolveCountryDisplayName(focusRecord, 'tr')}
          identityLine={mapV2ExperienceCopy.countryIdentityLine}
          onBack={goBackInMapScope}
        />
      ) : (
        <ScreenHeader
          title={headerTitle}
          subtitle={headerSubtitle}
          onBack={onClose}
          compact
          rightAction={
            <IconButton
              icon="refresh"
              onPress={() => canvasRef.current?.applyHome(animate)}
              accessibilityLabel={mapV2ExperienceCopy.resetWorld}
              size={18}
            />
          }
        />
      )}
      {mode === 'COUNTRY' ? (
        <MapV2CountryModeTabs
          active={countryTab}
          onChange={(tab) => {
            setCountryTab(tab);
          }}
        />
      ) : null}
      <View
        style={[
          styles.canvasWrap,
          mode === 'COUNTRY' && styles.canvasWrapCountry,
          mode === 'COUNTRY' && selectedCityId ? styles.canvasWrapCountrySelected : null,
          mode === 'COUNTRY' && countryTab !== 'map' ? styles.canvasCollapsed : null,
        ]}
        pointerEvents={mode === 'COUNTRY' && countryTab !== 'map' ? 'none' : 'auto'}
      >
        <MapV2ExperienceCanvas experience={experience} />
      </View>
      {mode === 'COUNTRY' && __DEV__ ? (
        <View style={styles.devChips}>
          <Pressable
            onPress={() =>
              setProgressionMode((current) =>
                current === 'MAP_V2_PROGRESSION_PREVIEW' ? 'LEGACY_ALL_UNLOCKED' : 'MAP_V2_PROGRESSION_PREVIEW',
              )
            }
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              progressionMode === 'MAP_V2_PROGRESSION_PREVIEW'
                ? mapV2ExperienceCopy.cityProgressionPreviewOn
                : mapV2ExperienceCopy.cityProgressionPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {progressionMode === 'MAP_V2_PROGRESSION_PREVIEW'
                ? mapV2ExperienceCopy.cityProgressionPreviewOn
                : mapV2ExperienceCopy.cityProgressionPreviewOff}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setRailVisualPreview((current) => !current)}
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              railVisualPreview
                ? mapV2ExperienceCopy.railVisualPreviewOn
                : mapV2ExperienceCopy.railVisualPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {railVisualPreview
                ? mapV2ExperienceCopy.railVisualPreviewOn
                : mapV2ExperienceCopy.railVisualPreviewOff}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setSeaVisualPreview((current) => !current)}
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              seaVisualPreview ? mapV2ExperienceCopy.seaVisualPreviewOn : mapV2ExperienceCopy.seaVisualPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {seaVisualPreview
                ? mapV2ExperienceCopy.seaVisualPreviewOn
                : mapV2ExperienceCopy.seaVisualPreviewOff}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setAirVisualPreview((current) => !current)}
            style={styles.devChip}
            accessibilityRole="button"
            accessibilityLabel={
              airVisualPreview ? mapV2ExperienceCopy.airVisualPreviewOn : mapV2ExperienceCopy.airVisualPreviewOff
            }
          >
            <Text style={styles.devChipText}>
              {airVisualPreview
                ? mapV2ExperienceCopy.airVisualPreviewOn
                : mapV2ExperienceCopy.airVisualPreviewOff}
            </Text>
          </Pressable>
        </View>
      ) : null}
      {mode === 'COUNTRY' && countryTab === 'cities' ? (
        <MapV2CountryCitiesPane
          cities={overviewCities}
          selectedCityId={selectedCityId}
          operationsByGeoCityId={operationsByGeoCityId}
          availabilityByGeoCityId={availabilityByGeoCityId}
          onSelect={setSelectedCityId}
          onInspect={enterCityDetail}
        />
      ) : null}
      {mode === 'COUNTRY' &&
      selectedCity &&
      selectedCityLocked &&
      selectedCityProgression &&
      (countryTab === 'map' || countryTab === 'cities') ? (
        <MapV2CityLockPanel
          displayName={resolveCityDisplayName(selectedCity, 'tr')}
          progression={selectedCityProgression}
          onClose={() => setSelectedCityId(null)}
        />
      ) : null}
      {mode === 'COUNTRY' && (countryTab === 'contracts' || countryTab === 'trade') ? (
        <View style={styles.soon}>
          <Text style={styles.soonTitle}>{mapV2ExperienceCopy.comingSoonTitle}</Text>
          <Text style={styles.soonBody}>{mapV2ExperienceCopy.comingSoonTabBody}</Text>
        </View>
      ) : null}
      {mode === 'COUNTRY' && countryTab === 'map' ? (
        <>
          {focusCountryId === 'country.tur' && selectedCity && !selectedCityLocked ? (
            <MapV2CitySelectionPanel
              displayName={resolveCityDisplayName(selectedCity, 'tr')}
              city={selectedCity}
              showDevFields={false}
              compactOps
              operation={selectedOperation}
              onClose={() => setSelectedCityId(null)}
              onInspect={selectedCityId ? () => enterCityDetail(selectedCityId) : undefined}
            />
          ) : null}
          <MapV2CountryOverviewShell
            countryTitle={resolveCountryDisplayName(focusRecord, 'tr')}
            statusLabel={countryStatus}
            totalCities={gameplayCityCount}
            openCityCount={cityProgression.country.unlockedCities}
            progressRatio={cityProgression.country.progressRatio}
            onCta={onCountryCta}
            railPreview={railVisualPreview}
            seaPreview={seaVisualPreview}
            airPreview={airVisualPreview}
          />
        </>
      ) : null}
      {mode === 'WORLD' && selected && availability ? (
        <MapV2CountrySelectionPanel
          displayName={displayName}
          availability={availability}
          onClose={() => setSelectedId(null)}
          onPrimary={onPrimary}
        />
      ) : null}
      {mode === 'WORLD' && !(selected && availability) ? (
        <Text style={styles.hint}>{mapV2ExperienceCopy.tapHint}</Text>
      ) : null}
      {mode === 'WORLD' ? (
        <View style={styles.legend} accessibilityRole="summary" accessibilityLabel={`${mapV2ExperienceCopy.worldLegendStarter}, ${mapV2ExperienceCopy.worldLegendOpen}, ${mapV2ExperienceCopy.worldLegendLocked}`}>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.swatchStarter]} />
            <Text style={styles.legendText}>{mapV2ExperienceCopy.worldLegendStarter}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.swatchOpen]} />
            <Text style={styles.legendText}>{mapV2ExperienceCopy.worldLegendOpen}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.swatch, styles.swatchLocked]} />
            <Text style={styles.legendText}>{mapV2ExperienceCopy.worldLegendLocked}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background, paddingHorizontal: spacing.sm, gap: spacing.sm },
  rootCountry: { gap: spacing.sm },
  rootNarrow: { paddingHorizontal: spacing.xs, gap: spacing.sm },
  canvasWrap: {
    flex: 1,
    borderRadius: 36,
    overflow: 'hidden',
    minHeight: 220,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    backgroundColor: '#020814',
  },
  canvasWrapCountry: {
    flex: 1.45,
    minHeight: 248,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(110, 180, 220, 0.34)',
    backgroundColor: '#020B14',
  },
  canvasWrapCountrySelected: {
    borderColor: 'rgba(186, 236, 255, 0.55)',
  },
  canvasCollapsed: { flex: 0, minHeight: 0, height: 0, borderWidth: 0 },
  soon: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  soonTitle: { ...typography.cardTitle, color: colors.textPrimary },
  soonBody: { ...typography.bodySmall, color: colors.textSecondary },
  fade: { ...StyleSheet.absoluteFillObject },
  hint: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  legend: { flexDirection: 'row', gap: spacing.md, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  swatchStarter: { backgroundColor: '#1A6F96', borderWidth: 1, borderColor: '#5EC8FF' },
  swatchOpen: { backgroundColor: '#155A7A', borderWidth: 1, borderColor: '#3A8FBF' },
  swatchLocked: { backgroundColor: '#0C1D2E', borderWidth: 1, borderColor: '#2A4258' },
  legendText: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
  devChips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  devChip: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.border,
  },
  devChipText: { ...typography.caption, color: colors.textMuted, fontSize: 11 },
});
