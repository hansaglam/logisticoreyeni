import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, ScreenHeader } from '../../components/ui';
import { MIN_TOUCH_TARGET } from '../../constants/layout';
import { useTabBarLayout } from '../../hooks/useTabBarLayout';
import { colors, radius, spacing, typography } from '../../theme';
import { LEGACY_STABLE_GAMEPLAY_CITY_IDS } from '../domain/ids';
import {
  advanceMultimodalRuntime,
  calculateOverallProgress,
  createRuntimeFromFixture,
  getActiveShipmentStep,
  type MultimodalShipmentRuntime,
} from '../gameplay/multimodalRuntime';
import { createDevMultimodalRoadPlanningFleet } from '../gameplay/devMultimodalRoadPlanningFleet';
import {
  buildMultimodalVerticalSlice,
  listMultimodalVerticalSlicePairs,
  middleLegAdapterForPattern,
  type MultimodalVerticalSlicePattern,
} from '../gameplay/multimodalVerticalSlice';
import { planMultimodalRoadAssignment } from '../../domain/multimodalRoadAssignment';
import {
  evaluateRailMultimodalOfferAcceptance,
  generateRailMultimodalOffers,
} from '../../domain/multimodalRailOffer';
import {
  estimateMultimodalRailTariff,
  RAIL_TARIFF_CARGO_QUANTITY_UNIT,
  RAIL_TARIFF_DISTANCE_AUTHORITY,
} from '../../domain/multimodalRailTariff';
import { getTurkeyRoadTransferAccessArtifact } from '../world/multimodalRoadTransferAccessLoader';
import type { RoadAirRoadPreview } from '../gameplay/roadAirRoadFixture';
import type { RoadRailRoadPreview } from '../gameplay/roadRailRoadFixture';
import type { RoadSeaRoadPreview } from '../gameplay/roadSeaRoadFixture';
import { getTurkeyAirRouteDiagnostics } from '../world/airRouteDiagnosticsLoader';
import { getTurkeyPortPackage } from '../world/countryPortLoader';
import { getTurkeyMultimodalFoundation } from '../world/multimodalFoundationLoader';
import { getTurkeyRailRouteDiagnostics } from '../world/railRouteDiagnosticsLoader';
import { getTurkeySeaRouteDiagnostics } from '../world/seaRouteDiagnosticsLoader';

function stepStatusText(runtime: MultimodalShipmentRuntime, index: number): string {
  if (index % 2 === 0) {
    const leg = runtime.legStates[Math.floor(index / 2)];
    return `${leg.status} ${(leg.progress * 100).toFixed(0)}% · ${leg.plannedDurationGameSeconds}g-s ${leg.distanceKind}`;
  }
  const transfer = runtime.transferStates[Math.floor(index / 2)];
  return `${transfer.status} ${(transfer.progress * 100).toFixed(0)}% · ${transfer.plannedDurationGameSeconds}g-s ${transfer.durationPolicy}`;
}

type SlicePreview = RoadRailRoadPreview | RoadSeaRoadPreview | RoadAirRoadPreview;

function isSeaPreview(preview: SlicePreview): preview is RoadSeaRoadPreview {
  return 'seaRouteReference' in preview;
}

function isAirPreview(preview: SlicePreview): preview is RoadAirRoadPreview {
  return 'airRouteReference' in preview;
}

const PATTERNS: Array<{ id: MultimodalVerticalSlicePattern; label: string }> = [
  { id: 'ROAD_RAIL_ROAD', label: 'ROAD → RAIL → ROAD' },
  { id: 'ROAD_SEA_ROAD', label: 'ROAD → SEA → ROAD' },
  { id: 'ROAD_AIR_ROAD', label: 'ROAD → AIR → ROAD' },
];

export default function MapV2MultimodalShipmentSimulatorScreen({ onClose }: { onClose: () => void }) {
  const { contentBottomPadding } = useTabBarLayout();
  const foundation = useMemo(() => getTurkeyMultimodalFoundation(), []);
  const railDiagnostics = useMemo(() => getTurkeyRailRouteDiagnostics(), []);
  const seaDiagnostics = useMemo(() => getTurkeySeaRouteDiagnostics(), []);
  const airDiagnostics = useMemo(() => getTurkeyAirRouteDiagnostics(), []);
  const ports = useMemo(() => getTurkeyPortPackage(), []);
  const [pattern, setPattern] = useState<MultimodalVerticalSlicePattern>('ROAD_RAIL_ROAD');
  const pairs = useMemo(
    () => listMultimodalVerticalSlicePairs(pattern, foundation, railDiagnostics, seaDiagnostics, airDiagnostics),
    [airDiagnostics, foundation, pattern, railDiagnostics, seaDiagnostics],
  );
  const origins = useMemo(() => [...new Set(pairs.map((row) => row.origin))].sort(), [pairs]);
  const [origin, setOrigin] = useState('ankara');
  const destOptions = useMemo(
    () => pairs.filter((row) => row.origin === origin).map((row) => row.destination),
    [origin, pairs],
  );
  const [destination, setDestination] = useState('istanbul');
  const [offerSeed, setOfferSeed] = useState('dev-1');

  useEffect(() => {
    if (!origins.includes(origin)) {
      setOrigin(origins[0] ?? '');
    }
  }, [origin, origins]);

  useEffect(() => {
    if (!destOptions.includes(destination)) {
      setDestination(destOptions[0] ?? '');
    }
  }, [destOptions, destination]);

  const fixture = useMemo(
    () =>
      origin && destination
        ? buildMultimodalVerticalSlice({
            pattern,
            origin,
            destination,
            foundation,
            railDiagnostics,
            seaDiagnostics,
            airDiagnostics,
            ports,
          })
        : { ok: false as const, reason: 'select cities' },
    [airDiagnostics, destination, foundation, origin, pattern, ports, railDiagnostics, seaDiagnostics],
  );
  const seedRef = useRef<MultimodalShipmentRuntime | null>(null);
  const [runtime, setRuntime] = useState<MultimodalShipmentRuntime | null>(null);

  useEffect(() => {
    setRuntime(null);
    seedRef.current = null;
  }, [origin, destination, pattern]);

  useEffect(() => {
    if (!runtime?.playing) return undefined;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      const wallDtMs = now - last;
      last = now;
      setRuntime((current) => (current ? advanceMultimodalRuntime(current, { type: 'TICK', wallDtMs }) : current));
    }, 50);
    return () => clearInterval(id);
  }, [runtime?.playing, runtime?.speed]);

  const assignment = useMemo(() => {
    if (!fixture.ok) return null;
    const fleet = createDevMultimodalRoadPlanningFleet({
      originCityId: origin,
      destinationCityId: destination,
    });
    return planMultimodalRoadAssignment({
      originCityId: origin,
      destinationCityId: destination,
      transferMode: middleLegAdapterForPattern(pattern),
      accessArtifact: getTurkeyRoadTransferAccessArtifact(),
      fleet,
      cargoWeightTons: 1,
    });
  }, [destination, fixture, origin, pattern]);

  const railTariff = useMemo(() => {
    if (pattern !== 'ROAD_RAIL_ROAD' || !fixture.ok) return null;
    if (!('railRouteReference' in fixture.preview)) return null;
    return estimateMultimodalRailTariff({
      routeReference: fixture.preview.railRouteReference,
      distanceMeters: fixture.preview.railDistanceMeters,
      distanceAuthority: RAIL_TARIFF_DISTANCE_AUTHORITY,
      cargoQuantity: 1,
      cargoQuantityUnit: RAIL_TARIFF_CARGO_QUANTITY_UNIT,
      sourceRailPackageHash: fixture.preview.sourceRailPackageHash,
      intent: 'PLAN',
    });
  }, [fixture, pattern]);

  const railOffers = useMemo(() => {
    if (pattern !== 'ROAD_RAIL_ROAD') return null;
    return generateRailMultimodalOffers({
      generationSeed: offerSeed,
      accessArtifact: getTurkeyRoadTransferAccessArtifact(),
      playerLevel: 1,
    });
  }, [offerSeed, pattern]);

  const focusedOffer = useMemo(() => {
    if (!railOffers?.offers.length) return null;
    return (
      railOffers.offers.find((row) => row.originCityId === origin && row.destinationCityId === destination) ??
      railOffers.offers[0]
    );
  }, [destination, origin, railOffers]);

  const offerAcceptance = useMemo(() => {
    if (!focusedOffer) return null;
    return evaluateRailMultimodalOfferAcceptance({
      offer: focusedOffer,
      accessArtifact: getTurkeyRoadTransferAccessArtifact(),
      fleet: createDevMultimodalRoadPlanningFleet({
        originCityId: focusedOffer.originCityId,
        destinationCityId: focusedOffer.destinationCityId,
      }),
      productionCheck: true,
    });
  }, [focusedOffer]);

  const start = () => {
    if (!fixture.ok) return;
    const created = createRuntimeFromFixture(fixture);
    seedRef.current = created;
    setRuntime(advanceMultimodalRuntime(created, { type: 'START' }));
  };

  const dispatch = (event: Parameters<typeof advanceMultimodalRuntime>[1]) => {
    setRuntime((current) => (current ? advanceMultimodalRuntime(current, event) : current));
  };

  const active = runtime ? getActiveShipmentStep(runtime) : null;
  const overall = runtime ? calculateOverallProgress(runtime) : 0;
  const middleLabel = pattern === 'ROAD_AIR_ROAD' ? 'AIR' : pattern === 'ROAD_SEA_ROAD' ? 'SEA' : 'RAIL';
  const timeline = ['ROAD origin', 'Transfer 1', middleLabel, 'Transfer 2', 'ROAD destination'];
  const patternLabel = PATTERNS.find((row) => row.id === pattern)?.label ?? pattern;

  return (
    <View style={[styles.root, { paddingBottom: contentBottomPadding }]}>
      <ScreenHeader
        title="Multimodal Shipment Simulator"
        subtitle={`DEV · ${patternLabel} · not live Delivery`}
        onBack={onClose}
        compact
        titleIcon="map"
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.note}>
          In-memory only. Planned duration is multimodal-duration-policy-v1 (game seconds).
          First/last-mile trucks are PLANNED ASSIGNMENT only — no reservation or live dispatch.
          Inspector speed is DEV wall-clock playback only. AIR is not a flight plan. No money,
          warehouses, or save writes.
        </Text>
        <View style={styles.card}>
          <Text style={styles.title}>Transport pattern</Text>
          <View style={styles.chips}>
            {PATTERNS.map((row) => (
              <Pressable
                key={row.id}
                onPress={() => setPattern(row.id)}
                style={[styles.chip, pattern === row.id && styles.chipOn, { minHeight: MIN_TOUCH_TARGET }]}
                accessibilityRole="button"
                accessibilityLabel={row.label}
                accessibilityState={{ selected: pattern === row.id }}
              >
                <Text style={styles.chipText}>{row.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.title}>Origin</Text>
          <View style={styles.chips}>
            {origins.map((city) => (
              <Pressable
                key={`o:${city}`}
                onPress={() => setOrigin(city)}
                style={[styles.chip, origin === city && styles.chipOn, { minHeight: MIN_TOUCH_TARGET }]}
                accessibilityRole="button"
                accessibilityLabel={`Origin ${city}`}
                accessibilityState={{ selected: origin === city }}
              >
                <Text style={styles.chipText}>{city}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.title}>Destination</Text>
          <View style={styles.chips}>
            {destOptions.map((city) => (
              <Pressable
                key={`d:${city}`}
                onPress={() => setDestination(city)}
                style={[styles.chip, destination === city && styles.chipOn, { minHeight: MIN_TOUCH_TARGET }]}
                accessibilityRole="button"
                accessibilityLabel={`Destination ${city}`}
                accessibilityState={{ selected: destination === city }}
              >
                <Text style={styles.chipText}>{city}</Text>
              </Pressable>
            ))}
          </View>
          {LEGACY_STABLE_GAMEPLAY_CITY_IDS.filter((city) => !origins.includes(city)).map((city) => (
            <Text key={`ineligible:${city}`} style={styles.meta}>
              {city}: {patternLabel} slice unavailable
            </Text>
          ))}
        </View>

        {!fixture.ok ? (
          <View style={styles.card}>
            <Text style={styles.title}>BLOCKED</Text>
            <Text style={styles.line}>{fixture.reason}</Text>
          </View>
        ) : (
          <View style={styles.card}>
            <Text style={styles.title}>Plan preview</Text>
            {isAirPreview(fixture.preview) ? (
              <>
                <Text style={styles.line}>
                  {fixture.preview.originCityId} ROAD {fixture.preview.originRoadNodeId}
                </Text>
                <Text style={styles.line}>
                  Transfer {fixture.preview.originTransferId} · {fixture.preview.originIata} (
                  {fixture.preview.originIcao ?? '—'})
                </Text>
                <Text style={[styles.line, styles.air]}>
                  AIR {fixture.preview.originIata} → {fixture.preview.destinationIata} ·{' '}
                  {fixture.preview.airDistanceMeters} m geodesic
                </Text>
                <Text style={styles.line}>
                  Cargo {fixture.preview.originCargoCapability} / {fixture.preview.destinationCargoCapability} ·
                  readiness {fixture.preview.originReadiness} / {fixture.preview.destinationReadiness}
                </Text>
                <Text style={styles.line}>
                  Transfer {fixture.preview.destinationTransferId} → {fixture.preview.destinationCityId}{' '}
                  {fixture.preview.destinationIata}
                </Text>
                <Text style={styles.meta}>{fixture.preview.airSemantics}</Text>
                <Text style={styles.meta}>
                  Legs {fixture.preview.legCount} · Transfers {fixture.preview.transferCount} ·{' '}
                  {fixture.preview.airRouteReference}
                </Text>
                <Text style={styles.meta}>
                  source-backed · {fixture.preview.geodesicAlgorithmVersion} · samples {fixture.preview.sampleCount}
                </Text>
                <Text style={styles.meta}>{fixture.preview.sourceAirportArtifactHash}</Text>
                {fixture.preview.optionalVisualCorridorId ? (
                  <Text style={styles.meta}>
                    visual corridor (display-only, not routing truth): {fixture.preview.optionalVisualCorridorId}
                  </Text>
                ) : null}
              </>
            ) : isSeaPreview(fixture.preview) ? (
              <>
                <Text style={styles.line}>
                  {fixture.preview.originCityId} ROAD {fixture.preview.originRoadNodeId}
                </Text>
                <Text style={styles.line}>
                  Transfer {fixture.preview.originTransferId} · {fixture.preview.originGeoPortName} (
                  {fixture.preview.originPortAssociation})
                </Text>
                <Text style={styles.line}>
                  Origin sea access {fixture.preview.originSeaAccessId} · {fixture.preview.originSeaAccessStatus}
                </Text>
                <Text style={[styles.line, styles.sea]}>
                  SEA {fixture.preview.originGeoPortName} → {fixture.preview.destinationGeoPortName} ·{' '}
                  {fixture.preview.seaDistanceMeters} m
                </Text>
                <Text style={styles.line}>Regions {fixture.preview.regions.join(' → ') || '—'}</Text>
                <Text style={styles.line}>
                  Channels {fixture.preview.channels.length ? fixture.preview.channels.join(', ') : 'none'}
                </Text>
                <Text style={styles.line}>
                  Transfer {fixture.preview.destinationTransferId} · {fixture.preview.destinationGeoPortName} (
                  {fixture.preview.destinationPortAssociation})
                </Text>
                <Text style={styles.line}>
                  Destination sea access {fixture.preview.destinationSeaAccessId} ·{' '}
                  {fixture.preview.destinationSeaAccessStatus}
                </Text>
                <Text style={styles.meta}>
                  Legs {fixture.preview.legCount} · Transfers {fixture.preview.transferCount} ·{' '}
                  {fixture.preview.seaRouteReference}
                </Text>
                <Text style={styles.meta}>
                  source-backed · {fixture.preview.routeAlgorithmVersion} · {fixture.preview.routeCostPolicyVersion}
                </Text>
                <Text style={styles.meta}>{fixture.preview.sourceSeaPackageHash}</Text>
                {fixture.preview.optionalVisualCorridorId ? (
                  <Text style={styles.meta}>
                    visual corridor (display-only, not routing truth): {fixture.preview.optionalVisualCorridorId}
                  </Text>
                ) : null}
              </>
            ) : (
              <>
                <Text style={styles.line}>
                  {fixture.preview.originCityId} ROAD {fixture.preview.originRoadNodeId}
                </Text>
                <Text style={styles.line}>
                  Transfer {fixture.preview.originTransferId} →{' '}
                  {fixture.preview.originRailAccessName ?? fixture.preview.originRailAccessId}
                </Text>
                <Text style={styles.line}>
                  RAIL {fixture.preview.originRailAccessName} → {fixture.preview.destinationRailAccessName} ·{' '}
                  {fixture.preview.railDistanceMeters} m
                </Text>
                <Text style={styles.line}>
                  Transfer {fixture.preview.destinationTransferId} → {fixture.preview.destinationCityId}
                </Text>
                <Text style={styles.meta}>
                  Legs {fixture.preview.legCount} · Transfers {fixture.preview.transferCount} ·{' '}
                  {fixture.preview.railRouteReference}
                </Text>
                <Text style={styles.meta}>
                  {fixture.preview.routeAlgorithmVersion} · {fixture.preview.sourceRailPackageHash}
                </Text>
              </>
            )}
          </View>
        )}

        {assignment ? (
          <View style={styles.card}>
            <Text style={styles.title}>PLANNED ASSIGNMENT (not live dispatch)</Text>
            <Text style={styles.meta}>
              {assignment.status} · {assignment.policyVersion} · {assignment.toctou}
            </Text>
            {([assignment.firstMile, assignment.lastMile] as const).map((leg) => (
              <View key={leg.role} style={styles.node}>
                <Text style={styles.line}>
                  {leg.role} · {leg.legacyCityId} · {leg.status}
                </Text>
                <Text style={styles.meta}>
                  truck {leg.truckId ?? '—'} · driver {leg.driverId ?? '—'} · trailer {leg.trailerId ?? '—'}
                </Text>
                <Text style={styles.meta}>
                  infra {leg.infrastructureId ?? '—'} · {(leg.distanceMeters ?? 0) / 1000} km · {leg.evidenceStatus}
                </Text>
                <Text style={styles.meta}>{leg.routeReference ?? '—'}</Text>
              </View>
            ))}
            {runtime ? (
              <Text style={styles.meta}>
                ROAD durations {runtime.legStates[0]?.plannedDurationGameSeconds}g-s /{' '}
                {runtime.legStates[2]?.plannedDurationGameSeconds}g-s ({runtime.legStates[0]?.distanceKind})
              </Text>
            ) : (
              <Text style={styles.meta}>Start simulation to see Step 24 ROAD duration from this access distance.</Text>
            )}
          </View>
        ) : null}

        {railTariff ? (
          <View style={styles.card}>
            <Text style={styles.title}>RAIL TARIFF — PLANNING ONLY</Text>
            <Text style={styles.meta}>
              {railTariff.status} · {railTariff.policyVersion} · not paid
            </Text>
            <Text style={styles.meta}>{railTariff.routeReference}</Text>
            <Text style={styles.meta}>
              {(railTariff.distanceMeters ?? 0) / 1000} km · {railTariff.cargoQuantity} {railTariff.cargoQuantityUnit}
            </Text>
            <Text style={styles.meta}>
              base ${railTariff.baseCharge ?? '—'} · line-haul ${railTariff.distanceQuantityCharge ?? '—'} · terminal $
              {railTariff.transferCharge ?? '—'} · min adj ${railTariff.minimumChargeAdjustment ?? '—'}
            </Text>
            <Text style={styles.line}>
              total rail carrier cost ${railTariff.totalCarrierCost ?? '—'} {railTariff.currency}
            </Text>
            <Text style={styles.meta}>{railTariff.geography.sourceRailPackageHash}</Text>
            <Text style={styles.meta}>GAMEPLAY BALANCE — NOT REAL RAIL PRICING</Text>
          </View>
        ) : pattern === 'ROAD_SEA_ROAD' || pattern === 'ROAD_AIR_ROAD' ? (
          <View style={styles.card}>
            <Text style={styles.title}>
              {pattern === 'ROAD_SEA_ROAD' ? 'SEA' : 'AIR'} TARIFF — NOT_IMPLEMENTED / FUTURE_STEP
            </Text>
            <Text style={styles.meta}>No SEA/AIR carrier tariff in Step 26. Planning only.</Text>
          </View>
        ) : null}

        {pattern === 'ROAD_RAIL_ROAD' && railOffers ? (
          <View style={styles.card}>
            <Text style={styles.title}>RAIL MULTIMODAL OFFER — FOUNDATION ONLY</Text>
            <Text style={styles.meta}>seed {railOffers.generationSeed} · {railOffers.offers.length} offers</Text>
            <Text style={styles.meta}>NOT LIVE · NO MONEY MOVED · NO RESOURCES RESERVED · RAIL FOUNDATION_ONLY</Text>
            {focusedOffer ? (
              <>
                <Text style={styles.line}>{focusedOffer.offerId}</Text>
                <Text style={styles.meta}>
                  schema {focusedOffer.offerSchemaVersion} · {focusedOffer.transportPattern} · {focusedOffer.originCityId}→
                  {focusedOffer.destinationCityId}
                </Text>
                <Text style={styles.meta}>
                  {focusedOffer.cargo.productId} {focusedOffer.cargo.quantity} {focusedOffer.cargo.quantityUnit}
                </Text>
                <Text style={styles.meta}>
                  first {(focusedOffer.firstMileAccess.distanceMeters / 1000).toFixed(2)} km · rail{' '}
                  {(focusedOffer.railDistanceMeters / 1000).toFixed(1)} km · last{' '}
                  {(focusedOffer.lastMileAccess.distanceMeters / 1000).toFixed(2)} km
                </Text>
                <Text style={styles.meta}>
                  planned {focusedOffer.durationSnapshot.totalDurationGameSeconds}g-s · deadline{' '}
                  {focusedOffer.deadlineSnapshot.deadlineGameSeconds}g-s
                </Text>
                <Text style={styles.line}>
                  payment ${focusedOffer.playerPayment} · rail ${focusedOffer.economics.railCarrierCost} · ROAD opex $
                  {focusedOffer.economics.estimatedRoadOperatingCost} · margin $
                  {focusedOffer.economics.expectedGrossMargin} (
                  {Math.round(focusedOffer.economics.expectedGrossMarginRatio * 100)}%)
                </Text>
                <Text style={styles.meta}>
                  duration {focusedOffer.durationSnapshot.policyVersion} · tariff{' '}
                  {focusedOffer.railTariffSnapshot.railTariffPolicyVersion} · economics{' '}
                  {focusedOffer.economics.policyVersion}
                </Text>
                <Text style={styles.meta}>
                  fleet {offerAcceptance?.fleetFeasibility ?? '—'} · first truck{' '}
                  {offerAcceptance?.suggestedFirstMileTruckId ?? '—'} · last truck{' '}
                  {offerAcceptance?.suggestedLastMileTruckId ?? '—'}
                </Text>
                <Text style={styles.meta}>{offerAcceptance?.reasons.join(' · ')}</Text>
              </>
            ) : (
              <Text style={styles.meta}>No READY offer for this seed.</Text>
            )}
            <View style={styles.row}>
              <ActionButton
                label="Generate Sample Offers"
                onPress={() =>
                  setOfferSeed((current) => (current === 'dev-1' ? 'dev-2' : current === 'dev-2' ? 'dev-3' : 'dev-1'))
                }
                compact
                variant="secondary"
                accessibilityLabel="Cycle multimodal offer seed"
              />
            </View>
          </View>
        ) : pattern === 'ROAD_SEA_ROAD' || pattern === 'ROAD_AIR_ROAD' ? (
          <View style={styles.card}>
            <Text style={styles.title}>
              {pattern === 'ROAD_SEA_ROAD' ? 'SEA' : 'AIR'} OFFER — NOT_IMPLEMENTED / FUTURE_STEP
            </Text>
          </View>
        ) : null}

        <View style={styles.row}>
          <ActionButton
            label="Start Simulation"
            onPress={start}
            disabled={!fixture.ok}
            compact
            accessibilityLabel="Start multimodal simulation"
          />
        </View>
        {runtime ? (
          <>
            <View style={styles.card}>
              <Text style={styles.title}>Shipment</Text>
              <Text style={styles.line}>Status: {runtime.status}</Text>
              <Text style={styles.line}>Current: {active?.label ?? '—'}</Text>
              <Text style={styles.line}>
                Mode: {active?.kind === 'LEG' ? runtime.legStates[active.slot].mode : active ? 'TRANSFER' : '—'}
              </Text>
              <Text style={styles.line}>Overall progress: {(overall * 100).toFixed(1)}%</Text>
              <Text style={styles.meta}>
                Planned {runtime.durationEstimate.totalDurationGameSeconds ?? '—'} game-s · policy{' '}
                {runtime.durationEstimate.policyVersion} · {runtime.durationEstimate.status}
              </Text>
              <Text style={styles.meta}>
                DEV playback {runtime.speed}x · sim {Math.round(runtime.simulationTimeMs)} ms (not planned duration)
              </Text>
              <Text style={styles.meta}>
                Carrier {runtime.roadCarrier} · cargo {runtime.cargo.kind} {runtime.cargo.units}u
              </Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.title}>Timeline</Text>
              {timeline.map((label, index) => {
                const current = runtime.currentStepIndex === index && runtime.status === 'ACTIVE';
                const seaStep = label === 'SEA';
                const airStep = label === 'AIR';
                return (
                  <View key={`${label}:${index}`} style={[styles.step, current && styles.stepOn]}>
                    <Text style={[styles.line, seaStep && styles.sea, airStep && styles.air]}>
                      {current ? '▶ ' : '  '}
                      {seaStep ? '⚓ ' : airStep ? '✈ ' : ''}
                      {label}: {stepStatusText(runtime, index)}
                    </Text>
                  </View>
                );
              })}
            </View>
            {runtime.transferNodes.map((node, index) => {
              const sea = node.supportedModes.includes('SEA');
              const air = node.supportedModes.includes('AIR');
              const seaPreview = fixture.ok && isSeaPreview(fixture.preview) ? fixture.preview : null;
              const airPreview = fixture.ok && isAirPreview(fixture.preview) ? fixture.preview : null;
              const association =
                seaPreview && index === 0
                  ? seaPreview.originPortAssociation
                  : seaPreview && index === 1
                    ? seaPreview.destinationPortAssociation
                    : null;
              const seaAccessId =
                seaPreview && index === 0
                  ? seaPreview.originSeaAccessId
                  : seaPreview && index === 1
                    ? seaPreview.destinationSeaAccessId
                    : null;
              const iata =
                airPreview && index === 0
                  ? airPreview.originIata
                  : airPreview && index === 1
                    ? airPreview.destinationIata
                    : null;
              const icao =
                airPreview && index === 0
                  ? airPreview.originIcao
                  : airPreview && index === 1
                    ? airPreview.destinationIcao
                    : null;
              const cargo =
                airPreview && index === 0
                  ? airPreview.originCargoCapability
                  : airPreview && index === 1
                    ? airPreview.destinationCargoCapability
                    : null;
              const readiness =
                airPreview && index === 0
                  ? airPreview.originReadiness
                  : airPreview && index === 1
                    ? airPreview.destinationReadiness
                    : null;
              return (
                <View key={node.id} style={styles.card}>
                  <Text style={styles.title}>Transfer {index + 1}</Text>
                  <Text style={styles.line}>
                    {node.gameplayCityId} · ROAD ↔ {air ? 'AIR' : sea ? 'SEA' : 'RAIL'} · {node.verificationStatus}
                  </Text>
                  {air ? (
                    <>
                      <Text style={styles.line}>GeoAirport {node.lineage.geoAirportId}</Text>
                      <Text style={styles.line}>
                        IATA {iata ?? '—'} · ICAO {icao ?? '—'}
                      </Text>
                      <Text style={styles.line}>ROAD↔AIR · cargo {cargo ?? '—'} · readiness {readiness ?? '—'}</Text>
                      <Text style={styles.line}>Verification {node.verificationStatus}</Text>
                    </>
                  ) : sea ? (
                    <>
                      <Text style={styles.line}>GeoPort {node.lineage.geoPortId}</Text>
                      <Text style={styles.line}>City–port association {association ?? '—'}</Text>
                      <Text style={styles.line}>PortSeaAccess {seaAccessId ?? '—'}</Text>
                      <Text style={styles.line}>Verification {node.verificationStatus}</Text>
                    </>
                  ) : (
                    <Text style={styles.line}>Access {node.lineage.railAccessId}</Text>
                  )}
                  <Text style={styles.meta}>{node.evidence[0]?.reason}</Text>
                </View>
              );
            })}
            <View style={styles.row}>
              <ActionButton
                label={runtime.playing ? 'Pause' : 'Resume'}
                onPress={() => dispatch({ type: runtime.playing ? 'PAUSE' : 'RESUME' })}
                compact
                variant="secondary"
                disabled={runtime.status !== 'ACTIVE'}
                accessibilityLabel={runtime.playing ? 'Pause simulation' : 'Resume simulation'}
              />
              <ActionButton
                label="1x"
                onPress={() => dispatch({ type: 'SET_SPEED', speed: 1 })}
                compact
                variant="secondary"
                accessibilityLabel="Speed one times"
              />
              <ActionButton
                label="4x"
                onPress={() => dispatch({ type: 'SET_SPEED', speed: 4 })}
                compact
                variant="secondary"
                accessibilityLabel="Speed four times"
              />
              <ActionButton
                label="16x"
                onPress={() => dispatch({ type: 'SET_SPEED', speed: 16 })}
                compact
                variant="secondary"
                accessibilityLabel="Speed sixteen times"
              />
            </View>
            <View style={styles.row}>
              <ActionButton
                label="Fail current leg"
                onPress={() => dispatch({ type: 'FAIL_LEG' })}
                compact
                variant="danger"
                disabled={runtime.status !== 'ACTIVE'}
                accessibilityLabel="Fail current transport leg"
              />
              <ActionButton
                label="Block transfer"
                onPress={() => dispatch({ type: 'BLOCK_TRANSFER' })}
                compact
                variant="danger"
                disabled={runtime.status !== 'ACTIVE'}
                accessibilityLabel="Block current transfer"
              />
            </View>
            <View style={styles.row}>
              <ActionButton
                label="Cancel"
                onPress={() => dispatch({ type: 'CANCEL' })}
                compact
                variant="secondary"
                accessibilityLabel="Cancel shipment"
              />
              <ActionButton
                label="Reset"
                onPress={() => seedRef.current && dispatch({ type: 'RESET', seed: seedRef.current })}
                compact
                variant="secondary"
                disabled={!seedRef.current}
                accessibilityLabel="Reset shipment to planned"
              />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.sm, gap: spacing.sm },
  note: { ...typography.bodySmall, color: colors.textSecondary },
  meta: { ...typography.caption, color: colors.textMuted },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: spacing.sm,
    gap: 4,
  },
  title: { ...typography.cardTitle, color: colors.textPrimary },
  line: { ...typography.caption, color: colors.textSecondary },
  node: { marginTop: 6, gap: 2 },
  sea: { color: colors.accentBlue },
  air: { color: colors.accentAmber },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipOn: { borderColor: colors.primaryLight, backgroundColor: colors.accentBlueSoft },
  chipText: { ...typography.caption, color: colors.textPrimary },
  step: { paddingVertical: 2 },
  stepOn: { backgroundColor: colors.accentBlueSoft, borderRadius: radius.sm, paddingHorizontal: 4 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
});
