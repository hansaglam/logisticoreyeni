/**
 * LogistiCore - Debug Simulation Ekranı
 *
 * Geliştirme ve test amaçlı panel. Ekonomi tick'leri, sözleşme üretimi,
 * teslimat akışı ve store bütünlüğünü hızlıca doğrulamak için kullanılır.
 * Final oyunda oyuncuya gösterilmemelidir.
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import { useGameStore, getRecentGameEvents } from '../store/gameStore';
import InternalTestInfoPanel from '../components/InternalTestInfoPanel';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import { UI } from '../theme/ui';
import { getCityName, getProductName } from '../utils/entityLookup';
import { canTruckCarryContract, getDeliveryIntegrityStats } from '../simulation/delivery';
import {
  calculateCompanyScore,
  formatCompanyScore,
  getCompanyScoreBreakdown,
} from '../simulation/companyScore';
import { BACKEND_ENABLED, CLOUD_SAVE_WRITE_ENABLED } from '../config/backendRoadmap';
import { getCloudSaveStatus } from '../storage/cloudSaveSync';
import { getTotalInventoryTons, summarizeFinanceLedger } from '../simulation/trading';
import { leaderboardConfig } from '../config/leaderboard';
import { getHighestOwnedTruckCapacity } from '../simulation/delivery';
import {
  countAvailableContracts,
  countContractsAboveLevel,
  countContractsAtOrBelowLevel,
  countContractsByOriginCity,
  countPlayableContracts,
  getContractLevelMixStats,
} from '../simulation/contracts';
import { getIdleTruckOriginCityIds, getActiveDeliveryDestinationCityIds } from '../simulation/delivery';
import { buildContractPreview } from '../simulation/contractPreview';
import { getLevelProgress } from '../simulation/leveling';
import { contractBalance } from '../config/balance';
import { sendTestMarketNotification } from '../services/notifications';
import { getMaxContractTonnageForLevel } from '../config/levelConfig';
import type {
  City,
  CityProductState,
  Contract,
  ContractStatus,
  Delivery,
  DeliveryFailureReason,
  DeliveryIncidentType,
  Driver,
  GameEvent,
  GameEventImportance,
  Product,
  ProductId,
  StoreGameState,
  Truck,
} from '../types/game';

// ---------------------------------------------------------------------------
// Renk paleti — diğer ekranlarla aynı koyu lojistik tema
// ---------------------------------------------------------------------------

const COLORS = {
  background: '#070A12',
  card: '#111827',
  cardAlt: '#121826',
  border: '#1F2A3C',
  primary: '#F59E0B',
  secondary: '#38BDF8',
  success: '#22C55E',
  danger: '#EF4444',
  textPrimary: '#F9FAFB',
  textSecondary: '#9CA3AF',
  textMuted: '#64748B',
};

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const CRITICAL_SHORTAGE_RATIO = 0.35;
const HIGH_SURPLUS_RATIO = 1.5;
const CITY_SNAPSHOT_COUNT = 5;
const AVAILABLE_CONTRACT_PREVIEW = 5;

type IntegrityStatus = 'PASS' | 'WARN' | 'FAIL';
type MessageType = 'success' | 'error' | 'info';

interface StatusMessage {
  type: MessageType;
  text: string;
}

interface IntegrityCheck {
  label: string;
  status: IntegrityStatus;
  detail?: string;
}

interface CriticalProductRow {
  productId: ProductId;
  stock: number;
  targetStock: number;
  stockRatio: number;
  price: number;
}

// ---------------------------------------------------------------------------
// Format yardımcıları
// ---------------------------------------------------------------------------

function formatMoney(value: number): string {
  const rounded = Math.round(value);
  const sign = rounded < 0 ? '-' : '';
  return `${sign}$${Math.abs(rounded)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

function formatTime(hours: number): string {
  const totalHours = Math.max(0, Math.floor(hours));
  const day = Math.floor(totalHours / 24) + 1;
  const hourOfDay = totalHours % 24;
  return `Gün ${day} • ${hourOfDay.toString().padStart(2, '0')}:00`;
}

function formatSavedAt(timestamp: number | null): string {
  if (!timestamp) {
    return 'Never';
  }
  return new Date(timestamp).toLocaleString('tr-TR');
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatTons(value: number): string {
  return `${value.toFixed(1)} ton`;
}

// ---------------------------------------------------------------------------
// Şehir / sözleşme yardımcıları
// ---------------------------------------------------------------------------

function calculateProductStockRatio(state: CityProductState): number {
  const target = state.targetStock && state.targetStock > 0 ? state.targetStock : Math.max(state.stock, 1);
  return state.stock / target;
}

function getProductPrice(state: CityProductState & { price?: number }): number {
  return state.currentPrice ?? state.price ?? state.basePrice ?? 0;
}

function countContractsByStatus(contracts: Contract[], status: ContractStatus): number {
  return contracts.filter((c) => c.status === status).length;
}

function countCityShortages(city: City): number {
  if (!city?.products) return 0;
  return Object.values(city.products).filter(
    (state) => calculateProductStockRatio(state) < CRITICAL_SHORTAGE_RATIO,
  ).length;
}

function countCitySurpluses(city: City): number {
  if (!city?.products) return 0;
  return Object.values(city.products).filter(
    (state) => calculateProductStockRatio(state) > HIGH_SURPLUS_RATIO,
  ).length;
}

function calculateCityAveragePriceMultiplier(city: City): number {
  const states = Object.values(city.products ?? {});
  if (states.length === 0) return 1;
  const ratios = states.map((state) => {
    const base = Math.max(state.basePrice, 1);
    return getProductPrice(state) / base;
  });
  return ratios.reduce((sum, ratio) => sum + ratio, 0) / ratios.length;
}

function calculateCityTotalStock(city: City): number {
  return Object.values(city.products ?? {}).reduce((sum, state) => sum + (state.stock ?? 0), 0);
}

function calculateCityTotalTargetStock(city: City): number {
  return Object.values(city.products ?? {}).reduce((sum, state) => sum + (state.targetStock ?? 0), 0);
}

/** Stok oranı en düşük 3 ürün — kritik piyasa durumu için */
function getCriticalProducts(city: City): CriticalProductRow[] {
  return Object.entries(city.products ?? {})
    .map(([productId, state]) => ({
      productId: productId as ProductId,
      stock: state.stock ?? 0,
      targetStock: state.targetStock ?? 0,
      stockRatio: calculateProductStockRatio(state),
      price: getProductPrice(state),
    }))
    .sort((a, b) => a.stockRatio - b.stockRatio)
    .slice(0, 3);
}

function findIdleTruckForContract(trucks: Truck[], contract: Contract, product: Product): Truck | undefined {
  return trucks.find(
    (truck) => truck.status === 'idle' && canTruckCarryContract(truck, contract, product),
  );
}

function findIdleDriver(drivers: Driver[]): Driver | undefined {
  return drivers.find((driver) => driver.status === 'idle');
}

function getIntegrityColor(status: IntegrityStatus): string {
  switch (status) {
    case 'PASS':
      return COLORS.success;
    case 'WARN':
      return COLORS.primary;
    case 'FAIL':
      return COLORS.danger;
    default:
      return COLORS.textSecondary;
  }
}

function getMessageColor(type: MessageType): string {
  switch (type) {
    case 'success':
      return COLORS.success;
    case 'error':
      return COLORS.danger;
    default:
      return COLORS.secondary;
  }
}

function getImportanceColor(importance: GameEventImportance): string {
  switch (importance) {
    case 'high':
      return COLORS.danger;
    case 'medium':
      return COLORS.secondary;
    default:
      return COLORS.textMuted;
  }
}

/**
 * Store durumuna göre basit bütünlük kontrolleri.
 * PASS = sağlıklı, WARN = dikkat, FAIL = kritik sorun.
 */
function runIntegrityChecks(state: {
  player: StoreGameState['player'] | null | undefined;
  cities: City[];
  products: Product[];
  routes: StoreGameState['routes'];
  contracts: Contract[];
  activeDeliveries: Delivery[];
}): IntegrityCheck[] {
  const checks: IntegrityCheck[] = [];
  const { player, cities, products, routes, contracts, activeDeliveries } = state;

  checks.push({
    label: 'Player exists',
    status: player ? 'PASS' : 'FAIL',
    detail: player ? undefined : 'player is null',
  });

  checks.push({
    label: 'Cities loaded',
    status: cities.length > 0 ? 'PASS' : 'FAIL',
    detail: `${cities.length} cities`,
  });

  checks.push({
    label: 'Products loaded',
    status: products.length > 0 ? 'PASS' : 'FAIL',
    detail: `${products.length} products`,
  });

  checks.push({
    label: 'Routes loaded',
    status: routes.length > 0 ? 'PASS' : 'FAIL',
    detail: `${routes.length} routes`,
  });

  const trucks = player?.trucks ?? [];
  checks.push({
    label: 'At least one truck exists',
    status: trucks.length > 0 ? 'PASS' : 'FAIL',
    detail: `${trucks.length} trucks`,
  });

  const drivers = player?.drivers ?? [];
  checks.push({
    label: 'At least one driver exists',
    status: drivers.length > 0 ? 'PASS' : 'FAIL',
    detail: `${drivers.length} drivers`,
  });

  checks.push({
    label: 'Contracts generated',
    status: contracts.length > 0 ? 'PASS' : 'WARN',
    detail: `${contracts.length} contracts`,
  });

  const negativeStockCities = cities.filter((city) =>
    Object.values(city.products ?? {}).some((p) => (p.stock ?? 0) < 0),
  );
  checks.push({
    label: 'No negative city stock',
    status: negativeStockCities.length === 0 ? 'PASS' : 'FAIL',
    detail:
      negativeStockCities.length === 0
        ? undefined
        : `${negativeStockCities.length} cities with negative stock`,
  });

  const cash = player?.money ?? 0;
  checks.push({
    label: 'No negative player cash warning',
    status: cash >= 0 ? (cash < 5000 ? 'WARN' : 'PASS') : 'FAIL',
    detail: formatMoney(cash),
  });

  const contractIds = new Set(contracts.map((c) => c.id));
  const truckIds = new Set(trucks.map((t) => t.id));
  const driverIds = new Set(drivers.map((d) => d.id));

  const invalidContractRefs = activeDeliveries.filter((d) => !contractIds.has(d.contractId));
  checks.push({
    label: 'Active deliveries have valid contractId',
    status: invalidContractRefs.length === 0 ? 'PASS' : 'FAIL',
    detail:
      invalidContractRefs.length === 0 ? undefined : `${invalidContractRefs.length} invalid refs`,
  });

  const invalidTruckRefs = activeDeliveries.filter((d) => !truckIds.has(d.truckId));
  checks.push({
    label: 'Active deliveries have valid truckId',
    status: invalidTruckRefs.length === 0 ? 'PASS' : 'FAIL',
    detail: invalidTruckRefs.length === 0 ? undefined : `${invalidTruckRefs.length} invalid refs`,
  });

  const invalidDriverRefs = activeDeliveries.filter((d) => !driverIds.has(d.driverId));
  checks.push({
    label: 'Active deliveries have valid driverId',
    status: invalidDriverRefs.length === 0 ? 'PASS' : 'FAIL',
    detail: invalidDriverRefs.length === 0 ? undefined : `${invalidDriverRefs.length} invalid refs`,
  });

  return checks;
}

// ---------------------------------------------------------------------------
// Küçük yeniden kullanılabilir alt bileşenler
// ---------------------------------------------------------------------------

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

function Section({ title, children }: SectionProps) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

interface KpiCardProps {
  label: string;
  value: string;
  accentColor?: string;
}

function KpiCard({ label, value, accentColor = COLORS.primary }: KpiCardProps) {
  return (
    <View style={[styles.kpiCard, { borderColor: accentColor }]}>
      <Text style={styles.kpiLabel}>{label}</Text>
      <Text style={[styles.kpiValue, { color: accentColor }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

interface StatItemProps {
  label: string;
  value: string;
  color?: string;
}

function StatItem({ label, value, color = COLORS.textPrimary }: StatItemProps) {
  return (
    <View style={styles.statItem}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, { color }]} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

interface ProgressBarProps {
  progress: number;
  color: string;
}

function ProgressBar({ progress, color }: ProgressBarProps) {
  const clamped = Math.max(0, Math.min(1, progress));
  return (
    <View style={styles.progressTrack}>
      <View style={[styles.progressFill, { width: `${clamped * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

interface DebugButtonProps {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary' | 'success' | 'danger';
  disabled?: boolean;
}

function DebugButton({ label, onPress, variant = 'secondary', disabled = false }: DebugButtonProps) {
  const borderColor =
    variant === 'danger'
      ? COLORS.danger
      : variant === 'primary'
        ? COLORS.primary
        : variant === 'success'
          ? COLORS.success
          : COLORS.secondary;

  return (
    <TouchableOpacity
      style={[styles.debugButton, { borderColor }, disabled && styles.debugButtonDisabled]}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
    >
      <Text style={[styles.debugButtonText, disabled && styles.debugButtonTextDisabled]}>{label}</Text>
    </TouchableOpacity>
  );
}

// ---------------------------------------------------------------------------
// Ana ekran
// ---------------------------------------------------------------------------

export default function DebugSimulationScreen() {
  const { alert: showAlert } = useAppDialog();
  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const routes = useGameStore((state) => state.routes) ?? [];
  const contracts = useGameStore((state) => state.contracts) ?? [];
  const globalEconomy = useGameStore((state) => state.globalEconomy);
  const activeDeliveries = useGameStore((state) => state.activeDeliveries) ?? [];
  const marketNews = useGameStore((state) => state.marketNews) ?? [];
  const eventLog = useGameStore((state) => state.eventLog) ?? [];
  const financeLedger = useGameStore((state) => state.financeLedger) ?? [];
  const currentTime = useGameStore((state) => state.currentTime);
  const isPaused = useGameStore((state) => state.isPaused);
  const gameSpeed = useGameStore((state) => state.gameSpeed);
  const isGameReady = useGameStore((state) => state.isGameReady);

  const resetGame = useGameStore((state) => state.resetGame);
  const pauseGame = useGameStore((state) => state.pauseGame);
  const resumeGame = useGameStore((state) => state.resumeGame);
  const advanceTime = useGameStore((state) => state.advanceTime);
  const runEconomyTick = useGameStore((state) => state.runEconomyTick);
  const debugGenerateContractsFromCurrentCity = useGameStore(
    (state) => state.debugGenerateContractsFromCurrentCity,
  );
  const refreshContractsFromMarket = useGameStore((state) => state.refreshContractsFromMarket);
  const forceGeneratePlayableContracts = useGameStore(
    (state) => state.forceGeneratePlayableContracts,
  );
  const lastPlayableContractGeneratedTime = useGameStore(
    (state) => state.lastPlayableContractGeneratedTime,
  );
  const getContractRefreshRemainingSeconds = useGameStore(
    (state) => state.getContractRefreshRemainingSeconds,
  );
  const addNotification = useGameStore((state) => state.addNotification);
  const expireContracts = useGameStore((state) => state.expireContracts);
  const refuelOrUpdateFuelPrice = useGameStore((state) => state.refuelOrUpdateFuelPrice);
  const { contentBottomPadding } = useTabBarLayout();
  const clearOldMarketNews = useGameStore((state) => state.clearOldMarketNews);
  const clearOldGameEvents = useGameStore((state) => state.clearOldGameEvents);
  const saveGame = useGameStore((state) => state.saveGame);
  const loadGame = useGameStore((state) => state.loadGame);
  const clearSave = useGameStore((state) => state.clearSave);
  const resetGameForTesting = useGameStore((state) => state.resetGameForTesting);
  const getDebugSaveInfo = useGameStore((state) => state.getDebugSaveInfo);
  const marketAlerts = useGameStore((state) => state.marketAlerts) ?? [];
  const checkMarketPriceAlerts = useGameStore((state) => state.checkMarketPriceAlerts);
  const clearAllMarketAlerts = useGameStore((state) => state.clearAllMarketAlerts);
  const forceGenerateWorldEvent = useGameStore((state) => state.forceGenerateWorldEvent);
  const clearWorldEvents = useGameStore((state) => state.clearWorldEvents);
  const getActiveWorldEventsValue = useGameStore((state) => state.getActiveWorldEventsValue);
  const worldEvents = useGameStore((state) => state.worldEvents) ?? [];
  const saveStatus = useGameStore((state) => state.saveStatus);
  const saveError = useGameStore((state) => state.saveError);
  const refreshSaveStatus = useGameStore((state) => state.refreshSaveStatus);
  const startDelivery = useGameStore((state) => state.startDelivery);
  const startDeliveryAutoAssign = useGameStore((state) => state.startDeliveryAutoAssign);
  const updateDeliveries = useGameStore((state) => state.updateDeliveries);
  const completeDeliveryById = useGameStore((state) => state.completeDeliveryById);
  const failDeliveryById = useGameStore((state) => state.failDeliveryById);
  const addCompanyXp = useGameStore((state) => state.addCompanyXp);
  const getLevelBenefits = useGameStore((state) => state.getLevelBenefits);
  const debugAddCash = useGameStore((state) => state.debugAddCash);
  const debugRemoveCash = useGameStore((state) => state.debugRemoveCash);
  const debugSetCash = useGameStore((state) => state.debugSetCash);
  const debugAdvanceOneDay = useGameStore((state) => state.debugAdvanceOneDay);
  const debugAdvanceOfflineDays = useGameStore((state) => state.debugAdvanceOfflineDays);
  const debugSimulateOfflineRealMinutes = useGameStore((state) => state.debugSimulateOfflineRealMinutes);
  const debugProcessDailyCosts = useGameStore((state) => state.debugProcessDailyCosts);
  const dailyOperatingCostDebug = useGameStore((state) => state.dailyOperatingCostDebug);
  const lastDailyOperatingCostTime = useGameStore((state) => state.lastDailyOperatingCostTime);
  const debugExpireLeaseTruck = useGameStore((state) => state.debugExpireLeaseTruck);
  const debugGetEconomyBalanceSummary = useGameStore((state) => state.debugGetEconomyBalanceSummary);
  const debugInjectDeliveryIncident = useGameStore((state) => state.debugInjectDeliveryIncident);
  const contractGenerationDebug = useGameStore((state) => state.contractGenerationDebug);
  const deliverySettlementDebug = useGameStore((state) => state.deliverySettlementDebug);

  const [lastMessage, setLastMessage] = useState<StatusMessage>({
    type: 'info',
    text: 'Debug panel ready.',
  });
  const [cloudSaveInfo, setCloudSaveInfo] = useState(getCloudSaveStatus);

  const trucks = player?.trucks ?? [];
  const drivers = player?.drivers ?? [];
  const warehouses = player?.warehouses ?? [];
  const cash = player?.money ?? 0;
  const levelProgress = useMemo(
    () => (player ? getLevelProgress(player) : null),
    [player],
  );
  const levelBenefits = getLevelBenefits(player?.level ?? player?.companyLevel ?? 1);

  useEffect(() => {
    void refreshSaveStatus();
    setCloudSaveInfo(getCloudSaveStatus());
  }, [refreshSaveStatus]);

  useEffect(() => {
    const countdownInterval = setInterval(() => {
      setContractRefreshCountdown(getContractRefreshRemainingSeconds());
    }, 1000);
    return () => clearInterval(countdownInterval);
  }, [getContractRefreshRemainingSeconds]);

  const availableContracts = useMemo(
    () => contracts.filter((c) => c.status === 'available'),
    [contracts],
  );

  const previewContracts = availableContracts.slice(0, AVAILABLE_CONTRACT_PREVIEW);
  const citySnapshot = cities.slice(0, CITY_SNAPSHOT_COUNT);
  const recentEvents = useMemo(() => getRecentGameEvents(eventLog, 8), [eventLog]);
  const tradeSummary = useMemo(() => summarizeFinanceLedger(financeLedger), [financeLedger]);
  const companyScoreBreakdown = useMemo(
    () =>
      getCompanyScoreBreakdown({
        player,
        cities,
        products,
        financeLedger,
        currentTime,
      }),
    [player, cities, products, financeLedger, currentTime],
  );
  const companyScore = useMemo(
    () =>
      calculateCompanyScore({
        player,
        cities,
        products,
        financeLedger,
        currentTime,
      }),
    [player, cities, products, financeLedger, currentTime],
  );
  const totalInventoryTons = useMemo(() => getTotalInventoryTons(warehouses), [warehouses]);
  const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);

  const contractEconomyDebug = useMemo(() => {
    if (availableContracts.length === 0) {
      return null;
    }

    let paymentSum = 0;
    let costSum = 0;
    let profitSum = 0;
    let marginSum = 0;
    const level1Payments: number[] = [];
    const level1Margins: number[] = [];

    for (const contract of availableContracts) {
      const preview = buildContractPreview({
        contract,
        globalEconomy,
        trucks,
        drivers,
        companyLevel: playerLevel,
      });
      const payment = contract.payment ?? 0;
      const cost = preview.estimatedTripCost ?? 0;
      const profit = preview.estimatedOperationalProfit ?? 0;
      const margin = preview.estimatedMarginPercent ?? 0;

      paymentSum += payment;
      costSum += cost;
      profitSum += profit;
      marginSum += margin;

      if ((contract.requiredLevel ?? 1) <= 1) {
        level1Payments.push(payment);
        level1Margins.push(margin);
      }
    }

    const count = availableContracts.length;
    return {
      sampleCount: count,
      averageContractPayment: Math.round(paymentSum / count),
      averageEstimatedCost: Math.round(costSum / count),
      averageEstimatedNetProfit: Math.round(profitSum / count),
      averageMarginPercent: Math.round((marginSum / count) * 1000) / 10,
      level1ContractPaymentMin: level1Payments.length > 0 ? Math.min(...level1Payments) : 0,
      level1ContractPaymentMax: level1Payments.length > 0 ? Math.max(...level1Payments) : 0,
      level1MarginMin:
        level1Margins.length > 0 ? Math.round(Math.min(...level1Margins) * 1000) / 10 : 0,
      level1MarginMax:
        level1Margins.length > 0 ? Math.round(Math.max(...level1Margins) * 1000) / 10 : 0,
    };
  }, [availableContracts, globalEconomy, trucks, drivers, playerLevel]);

  const maxUnlockedTonnage = getMaxContractTonnageForLevel(playerLevel);
  const highestOwnedTruckCapacity = getHighestOwnedTruckCapacity(trucks);
  const contractsAtLevel = useMemo(
    () => countContractsAtOrBelowLevel(contracts, playerLevel),
    [contracts, playerLevel],
  );
  const contractsAboveLevel = useMemo(
    () => countContractsAboveLevel(contracts, playerLevel),
    [contracts, playerLevel],
  );
  const contractLevelMix = useMemo(
    () => getContractLevelMixStats(contracts, playerLevel),
    [contracts, playerLevel],
  );
  const idleTruckCities = useMemo(
    () => getIdleTruckOriginCityIds(trucks, player?.homeCityId),
    [trucks, player?.homeCityId],
  );
  const activeDeliveryDestinationCities = useMemo(
    () => getActiveDeliveryDestinationCityIds(activeDeliveries),
    [activeDeliveries],
  );
  const playableContractsCount = useMemo(
    () =>
      countPlayableContracts(
        contracts,
        trucks,
        player?.drivers ?? [],
        playerLevel,
        currentTime,
      ),
    [contracts, trucks, player?.drivers, playerLevel, currentTime],
  );
  const contractsByOriginCity = useMemo(
    () => countContractsByOriginCity(contracts),
    [contracts],
  );
  const [contractRefreshCountdown, setContractRefreshCountdown] = useState(
    contractBalance.contractRefreshIntervalMs / 1000,
  );
  const totalUsedCapacity = useMemo(
    () => warehouses.reduce((sum, warehouse) => sum + (warehouse.usedCapacityTon ?? 0), 0),
    [warehouses],
  );

  const integrityChecks = useMemo(
    () =>
      runIntegrityChecks({
        player,
        cities,
        products,
        routes,
        contracts,
        activeDeliveries,
      }),
    [player, cities, products, routes, contracts, activeDeliveries],
  );

  const deliveryIntegrity = useMemo(
    () =>
      getDeliveryIntegrityStats(activeDeliveries, {
        truckIds: new Set(trucks.map((truck) => truck.id)),
        driverIds: new Set(drivers.map((driver) => driver.id)),
        contractIds: new Set(contracts.map((contract) => contract.id)),
      }),
    [activeDeliveries, trucks, drivers, contracts],
  );

  const setSuccess = (text: string) => setLastMessage({ type: 'success', text });
  const setError = (text: string) => setLastMessage({ type: 'error', text });
  const setInfo = (text: string) => setLastMessage({ type: 'info', text });

  const handleAdvanceTime = (hours: number) => {
    try {
      advanceTime(hours);
      setSuccess(`Advanced ${hours} hour${hours === 1 ? '' : 's'} successfully`);
    } catch (error) {
      setError(error instanceof Error ? error.message : `Failed to advance ${hours} hours`);
    }
  };

  const handleRun7Days = () => {
    try {
      // Basit senkron döngü — async gerekmez; store action'ları sırayla çalıştırır.
      for (let day = 0; day < 7; day += 1) {
        advanceTime(24);
      }
      setSuccess('Ran 7-day simulation (7 × advanceTime(24))');
    } catch (error) {
      setError(error instanceof Error ? error.message : '7-day simulation failed');
    }
  };

  const handleRunEconomyTick = () => {
    try {
      const beforeCount = contracts.length;
      runEconomyTick();
      const afterCount = useGameStore.getState().contracts.length;
      setSuccess(`Economy tick completed. Contracts: ${beforeCount} → ${afterCount}`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Economy tick failed');
    }
  };

  const handleGenerateContracts = () => {
    try {
      const result = debugGenerateContractsFromCurrentCity();
      const originName = getCityName(result.originCityId);
      if (result.storedCount <= 0) {
        const skipped = result.skippedDestinations
          .map((s) => `${getCityName(s.destinationCityId)}:${s.reason}`)
          .join(', ');
        const lost = result.traces
          .filter((t) => t.result === 'lost-in-store' || t.result === 'hidden-in-ui')
          .map((t) => `${getCityName(t.destinationCityId)}:${t.result}`)
          .join(', ');
        setError(
          [
            `${originName} çıkışlı sözleşme havuza eklenemedi`,
            skipped ? `atlanan: ${skipped}` : null,
            lost ? `kayıp: ${lost}` : null,
            result.createdCount > 0
              ? `üretilen ${result.createdCount} aday store'da görünmedi`
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
        );
        return;
      }

      const stored = result.storedDestinations.map((id) => getCityName(id)).join(', ');
      const skipped = result.skippedDestinations
        .map((s) => `${getCityName(s.destinationCityId)}:${s.reason}`)
        .join(', ');
      setSuccess(
        skipped
          ? `${originName} → ${stored} (${result.storedCount} iş eklendi) · atlanan: ${skipped}`
          : `${originName} → ${stored} (${result.storedCount} iş oluşturuldu ve sözleşme havuzuna eklendi)`,
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Generate contracts failed');
    }
  };

  const handleTestDeliveryNotification = () => {
    try {
      addNotification({
        time: currentTime,
        type: 'success',
        title: 'Teslimat tamamlandı',
        message:
          'İstanbul → Antalya teslimatı tamamlandı. Ödeme: $24,459 · Net kâr: $23,999',
        actionLabel: 'Finansı Gör',
        actionTarget: 'finance',
        autoDismissMs: 3000,
      });
      setSuccess('Test delivery notification shown (Debug)');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Test notification failed');
    }
  };

  const activeMarketAlertCount = useMemo(
    () => marketAlerts.filter((alert) => alert.isActive && !alert.triggeredAt).length,
    [marketAlerts],
  );
  const triggeredMarketAlertCount = useMemo(
    () => marketAlerts.filter((alert) => alert.triggeredAt).length,
    [marketAlerts],
  );

  const handleCheckMarketAlerts = () => {
    const triggered = checkMarketPriceAlerts({ sendInApp: true, sendLocal: true });
    setSuccess(`Alarm kontrolü tamamlandı. Tetiklenen: ${triggered.length}`);
  };

  const handleClearMarketAlerts = () => {
    void clearAllMarketAlerts().then(() => {
      setSuccess('Tüm piyasa alarmları temizlendi');
    });
  };

  const handleTestMarketNotification = () => {
    void sendTestMarketNotification()
      .then(() => setSuccess('Test piyasa bildirimi planlandı'))
      .catch((error: unknown) => {
        setError(error instanceof Error ? error.message : 'Test bildirimi başarısız');
      });
  };

  const handleStartTestDelivery = (contract: Contract) => {
    const result = startDeliveryAutoAssign(contract.id);
    if (!result.success) {
      setError(result.message ?? 'Failed to start delivery');
      return;
    }
    setSuccess(`Started delivery ${contract.id}`);
  };

  const handleCompleteNow = (delivery: Delivery) => {
    try {
      // completeDeliveryById progress >= 1 gerektirir; debug için kalan süreyi simüle et.
      if (delivery.progress < 1) {
        const hoursNeeded = Math.max(0.1, delivery.travelHours * (1 - delivery.progress));
        updateDeliveries(hoursNeeded);
      }

      const updated = useGameStore.getState().activeDeliveries.find((d) => d.id === delivery.id);
      if (updated && updated.progress >= 1 && updated.status === 'on_route') {
        completeDeliveryById(delivery.id);
        setSuccess(`Completed delivery ${delivery.id}`);
      } else if (!useGameStore.getState().activeDeliveries.find((d) => d.id === delivery.id)) {
        setSuccess(`Delivery ${delivery.id} auto-completed via updateDeliveries`);
      } else {
        setError(`Could not complete delivery ${delivery.id} — check progress/status`);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Complete delivery failed');
    }
  };

  const handleFailNow = (delivery: Delivery) => {
    try {
      // Store tipi debug_manual_fail kabul etmez; manuel iptal için 'cancelled' kullanılır.
      const reason: DeliveryFailureReason = 'cancelled';
      failDeliveryById(delivery.id, reason);
      setSuccess(`Failed delivery ${delivery.id} (debug manual fail → cancelled)`);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Fail delivery failed');
    }
  };

  const handleInjectDeliveryIncident = (incidentType?: DeliveryIncidentType) => {
    if (!__DEV__) {
      return;
    }
    const result = debugInjectDeliveryIncident(incidentType);
    if (!result.ok) {
      setError(result.reason ?? 'Incident enjekte edilemedi');
      return;
    }
    setSuccess(
      incidentType
        ? `Debug incident eklendi (${incidentType})`
        : 'Debug incident eklendi (rastgele tip)',
    );
  };

  const runningDeliveries = useMemo(
    () =>
      activeDeliveries.filter(
        (delivery) => delivery.status === 'on_route' || delivery.status === 'preparing',
      ),
    [activeDeliveries],
  );

  const handleSaveNow = async () => {
    try {
      await saveGame();
      await refreshSaveStatus();
      setCloudSaveInfo(getCloudSaveStatus());
      setSuccess('Manual save completed (debug only)');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Save failed');
    }
  };

  const handleLoadSave = async () => {
    try {
      const loaded = await loadGame();
      await refreshSaveStatus();
      if (loaded) {
        setSuccess('Save loaded successfully (debug only)');
      } else {
        setError('No valid save found to load');
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Load save failed');
    }
  };

  const handleClearSave = async () => {
    try {
      await clearSave();
      await refreshSaveStatus();
      setSuccess('Save cleared and fresh game started (debug only)');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Clear save failed');
    }
  };

  const handleResetTestSave = () => {
    showAlert(
      'Test kaydı sıfırlansın mı?',
      'Bu işlem mevcut oyun kaydını siler ve yeni oyun başlatır.',
      [
        { text: 'Vazgeç', style: 'cancel' },
        {
          text: 'Sıfırla',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await resetGameForTesting();
                await refreshSaveStatus();
                setSuccess('Test kaydı sıfırlandı. Yeni oyun başlatıldı.');
              } catch (error) {
                setError(error instanceof Error ? error.message : 'Test kaydı sıfırlanamadı');
              }
            })();
          },
        },
      ],
    );
  };

  const tutorial = useGameStore((state) => state.tutorial);
  const missions = useGameStore((state) => state.missions);

  const debugSaveInfo = useMemo(
    () => getDebugSaveInfo(),
    [
      currentTime,
      isGameReady,
      saveStatus.hasSave,
      saveStatus.isLoadingSave,
      tutorial?.currentStepId,
      tutorial?.completedStepIds,
      missions?.completedMissionIds,
      missions?.claimedMissionRewardIds,
    ],
  );
  const debugTutorialStepId = tutorial?.currentStepId ?? debugSaveInfo.tutorialStepId;
  const debugTutorialCompleted = tutorial?.completedStepIds ?? debugSaveInfo.tutorialCompletedStepIds;
  const debugMissionsCompleted = missions?.completedMissionIds ?? debugSaveInfo.missionsCompletedIds;
  const debugMissionsClaimed = missions?.claimedMissionRewardIds ?? debugSaveInfo.missionsClaimedRewardIds;

  const handleResetGame = () => {
    try {
      resetGame();
      void refreshSaveStatus();
      setSuccess('Game reset to initial state');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Reset game failed');
    }
  };

  const handleDebugAddCash = (amount: number) => {
    debugAddCash(amount);
    setSuccess(`${formatMoney(amount)} eklendi`);
  };

  const handleDebugRemoveCash = (amount: number) => {
    debugRemoveCash(amount);
    setInfo(`${formatMoney(amount)} düşürüldü`);
  };

  const handleDebugSetCash = (amount: number) => {
    debugSetCash(amount);
    setSuccess(amount === 0 ? 'Nakit sıfırlandı' : `Nakit ${formatMoney(amount)} yapıldı`);
  };

  if (!isGameReady || !player) {
    return (
      <View style={styles.safeArea}>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun yükleniyor...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.safeArea}>
      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={[styles.scrollContent, { paddingBottom: contentBottomPadding }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>Simülasyon Testi</Text>
          <Text style={styles.subtitle}>Internal test araçları — geliştirici kullanımı</Text>
          <View style={styles.headerStatsRow}>
            <View style={styles.headerStatBadge}>
              <Text style={[styles.headerStatValue, { color: COLORS.primary }]}>
                {formatTime(currentTime)}
              </Text>
              <Text style={styles.headerStatLabel}>Game Time</Text>
            </View>
            <View style={styles.headerStatBadge}>
              <Text style={[styles.headerStatValue, { color: COLORS.success }]}>
                {formatMoney(cash)}
              </Text>
              <Text style={styles.headerStatLabel}>Cash</Text>
            </View>
            <View style={styles.headerStatBadge}>
              <Text style={[styles.headerStatValue, { color: isPaused ? COLORS.danger : COLORS.success }]}>
                {isPaused ? 'PAUSED' : 'RUNNING'}
              </Text>
              <Text style={styles.headerStatLabel}>Status</Text>
            </View>
            <View style={styles.headerStatBadge}>
              <Text style={[styles.headerStatValue, { color: COLORS.secondary }]}>
                {gameSpeed.toFixed(2)}x
              </Text>
              <Text style={styles.headerStatLabel}>Speed</Text>
            </View>
          </View>
        </View>

        {/* Debug Log / Last Action Message */}
        <View style={[styles.messageBanner, { borderColor: getMessageColor(lastMessage.type) }]}>
          <Text style={[styles.messageText, { color: getMessageColor(lastMessage.type) }]}>
            {lastMessage.text}
          </Text>
        </View>

        <InternalTestInfoPanel />

        {/* TODO: Hide Internal Test Tools in production builds. */}
        <Section title="Internal Test Tools">
          <View style={styles.buttonGrid}>
            <DebugButton label="+1 Saat" onPress={() => handleAdvanceTime(1)} />
            <DebugButton label="+6 Saat" onPress={() => handleAdvanceTime(6)} />
            <DebugButton label="+24 Saat" onPress={() => handleAdvanceTime(24)} />
            <DebugButton label="Test Teslimat Bildirimi" onPress={handleTestDeliveryNotification} />
            <DebugButton label="Ekonomi Tick" onPress={handleRunEconomyTick} variant="primary" />
            <DebugButton label="Save Now" onPress={() => void handleSaveNow()} variant="primary" />
            <DebugButton label="Clear Save" onPress={() => void handleClearSave()} variant="danger" />
            <DebugButton label="Reset Game" onPress={handleResetGame} variant="danger" />
            <DebugButton label="+50 XP" onPress={() => { addCompanyXp(50, 'debug'); setInfo('+50 XP eklendi'); }} />
            <DebugButton label="+250 XP" onPress={() => { addCompanyXp(250, 'debug'); setInfo('+250 XP eklendi'); }} variant="primary" />
          </View>
        </Section>

        <Section title="Piyasa Alarmları (Debug)">
          <View style={styles.levelDebugPanel}>
            <Text style={styles.levelDebugLine}>active alerts: {activeMarketAlertCount}</Text>
            <Text style={styles.levelDebugLine}>triggered alerts: {triggeredMarketAlertCount}</Text>
          </View>
          <View style={styles.buttonGrid}>
            <DebugButton label="Force Check Alerts" onPress={handleCheckMarketAlerts} variant="primary" />
            <DebugButton label="Clear All Alerts" onPress={handleClearMarketAlerts} variant="danger" />
            <DebugButton label="Test Local Notification" onPress={handleTestMarketNotification} />
          </View>
        </Section>

        <Section title="Piyasa Olayları (Debug)">
          <View style={styles.levelDebugPanel}>
            <Text style={styles.levelDebugLine}>
              active events: {getActiveWorldEventsValue().length}
            </Text>
            <Text style={styles.levelDebugLine}>stored events: {worldEvents.length}</Text>
          </View>
          <View style={styles.buttonGrid}>
            <DebugButton
              label="Fuel Crisis"
              onPress={() => {
                forceGenerateWorldEvent('fuel_crisis');
                setInfo('Yakıt krizi olayı eklendi');
              }}
            />
            <DebugButton
              label="Electronics Boom"
              onPress={() => {
                forceGenerateWorldEvent('electronics_boom');
                setInfo('Elektronik patlaması eklendi');
              }}
              variant="primary"
            />
            <DebugButton
              label="Harvest Surplus"
              onPress={() => {
                forceGenerateWorldEvent('harvest_surplus');
                setInfo('Meyve bolluğu eklendi');
              }}
            />
            <DebugButton
              label="Clear World Events"
              onPress={() => {
                clearWorldEvents();
                setInfo('Piyasa olayları temizlendi');
              }}
              variant="danger"
            />
          </View>
        </Section>

        <Section title="Ekonomi Dengesi (V1)">
          <View style={styles.levelDebugPanel}>
            <Text style={styles.levelDebugLine}>
              lastDailyOperatingCostTime: {lastDailyOperatingCostTime ?? 0}h
            </Text>
            <Text style={styles.levelDebugLine}>currentTime: {currentTime.toFixed(1)}h</Text>
            <Text style={styles.levelDebugLine}>
              hoursUntilNextDailyCost: {(dailyOperatingCostDebug?.hoursUntilNextDailyCost ?? 0).toFixed(1)}h
            </Text>
            <Text style={styles.levelDebugLine}>
              dailyOperatingCost: {formatMoney(dailyOperatingCostDebug?.dailyOperatingCost ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              maxOfflineChargeDays: {dailyOperatingCostDebug?.maxOfflineChargeDays ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              elapsedOperatingDays: {dailyOperatingCostDebug?.elapsedOperatingDays ?? '—'}
            </Text>
            <Text style={styles.levelDebugLine}>
              chargedOperatingDays: {dailyOperatingCostDebug?.chargedOperatingDays ?? '—'}
            </Text>
            <Text style={styles.levelDebugLine}>
              skippedOperatingDaysDueToCap:{' '}
              {dailyOperatingCostDebug?.skippedOperatingDaysDueToCap ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              lastCharge:{' '}
              {dailyOperatingCostDebug?.lastCharge
                ? `${dailyOperatingCostDebug.lastCharge.elapsedDays} gün geçti · ${dailyOperatingCostDebug.lastCharge.days} gün kesildi · ${formatMoney(dailyOperatingCostDebug.lastCharge.total)} · ${dailyOperatingCostDebug.lastCharge.reason}`
                : '—'}
            </Text>
          </View>
          <View style={styles.buttonGrid}>
            <DebugButton
              label="+1 Gün"
              onPress={() => {
                try {
                  debugAdvanceOneDay();
                  setSuccess('1 oyun günü ilerletildi');
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Gün ilerletme başarısız');
                }
              }}
              variant="primary"
            />
            <DebugButton
              label="+10 Gün Offline"
              onPress={() => {
                try {
                  debugAdvanceOfflineDays(10);
                  setSuccess('10 oyun günü offline simülasyonu çalıştırıldı');
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Offline simülasyon başarısız');
                }
              }}
              variant="primary"
            />
            <DebugButton
              label="Offline 30 dk simüle et"
              onPress={() => {
                try {
                  const result = debugSimulateOfflineRealMinutes(30);
                  setSuccess(
                    `Gerçek süre: ${result.realMinutes} dk · Oyun zamanı: ${result.gameHours.toFixed(1)} saat · Hız: ${result.gameSpeed.toFixed(2)}x`,
                  );
                } catch (error) {
                  setError(error instanceof Error ? error.message : 'Offline simülasyon başarısız');
                }
              }}
              variant="primary"
            />
            <DebugButton
              label="Günlük Giderleri İşle"
              onPress={() => {
                debugProcessDailyCosts();
                setSuccess('Günlük operasyon giderleri işlendi');
              }}
            />
            <DebugButton
              label="Kiralık Süre Testi"
              onPress={() => {
                debugExpireLeaseTruck();
                setInfo('Boşta kiralık kamyon süresi dolduruldu (varsa)');
              }}
              variant="danger"
            />
            <DebugButton
              label="Economy Balance Summary"
              onPress={() => {
                const summary = debugGetEconomyBalanceSummary();
                setInfo(summary);
              }}
            />
          </View>
        </Section>

        {/* TODO: Hide debug cash tools in production builds. */}
        <Section title="Nakit Testi">
          <View style={styles.cashTestPanel}>
            <Text style={styles.cashTestLabel}>Mevcut nakit</Text>
            <Text style={styles.cashTestValue}>{formatMoney(cash)}</Text>
          </View>
          <View style={styles.buttonGrid}>
            <DebugButton label="+$10,000" onPress={() => handleDebugAddCash(10000)} variant="success" />
            <DebugButton label="+$50,000" onPress={() => handleDebugAddCash(50000)} variant="success" />
            <DebugButton label="+$250,000" onPress={() => handleDebugAddCash(250000)} variant="success" />
            <DebugButton label="-$10,000" onPress={() => handleDebugRemoveCash(10000)} variant="danger" />
            <DebugButton label="Nakit Sıfırla" onPress={() => handleDebugSetCash(0)} variant="danger" />
            <DebugButton label="$1M Yap" onPress={() => handleDebugSetCash(1_000_000)} variant="primary" />
          </View>
        </Section>

        {levelProgress ? (
          <Section title="Şirket Seviyesi (Debug)">
            <View style={styles.levelDebugPanel}>
              <Text style={styles.levelDebugLine}>Level: {levelProgress.level}</Text>
              <Text style={styles.levelDebugLine}>
                XP: {levelProgress.xp} / {levelProgress.xpToNextLevel}
              </Text>
              <Text style={styles.levelDebugLine}>Toplam XP: {levelProgress.totalXp}</Text>
              <Text style={styles.levelDebugLine}>
                Max tonaj: {levelBenefits.maxContractTonnage}t
              </Text>
            </View>
          </Section>
        ) : null}

        <Section title="Sözleşme Piyasası (Debug)">
          <View style={styles.levelDebugPanel}>
            <Text style={styles.levelDebugLine}>
              Available contracts: {countAvailableContracts(contracts)}
            </Text>
            <Text style={styles.levelDebugLine}>Player level: {playerLevel}</Text>
            <Text style={styles.levelDebugLine}>Max unlocked tonnage: {maxUnlockedTonnage}t</Text>
            <Text style={styles.levelDebugLine}>
              Highest owned truck capacity: {highestOwnedTruckCapacity.toFixed(1)}t
            </Text>
            <Text style={styles.levelDebugLine}>
              Contracts at/below level: {contractsAtLevel}
            </Text>
            <Text style={styles.levelDebugLine}>Contracts above level: {contractsAboveLevel}</Text>
            <Text style={styles.levelDebugLine}>
              At current level: {contractLevelMix.availableAtCurrentLevel}
            </Text>
            <Text style={styles.levelDebugLine}>
              One level above: {contractLevelMix.oneLevelAboveContracts}
            </Text>
            <Text style={styles.levelDebugLine}>
              Locked total: {contractLevelMix.lockedContracts} (
              {formatPercent(contractLevelMix.lockedRatio)})
            </Text>
            <Text style={styles.levelDebugLine}>
              Next contract refresh: {contractRefreshCountdown}s
            </Text>
            <Text style={styles.levelDebugLine}>
              — Üretim zamanlaması —
            </Text>
            <Text style={styles.levelDebugLine}>currentTime: {currentTime.toFixed(1)}h</Text>
            <Text style={styles.levelDebugLine}>
              availableContracts: {contractGenerationDebug?.availableContracts ?? countAvailableContracts(contracts)}
            </Text>
            <Text style={styles.levelDebugLine}>
              lastContractGenerationTime: {contractGenerationDebug?.lastContractGenerationTime ?? 0}h
            </Text>
            <Text style={styles.levelDebugLine}>
              hoursSinceLastGeneration: {(contractGenerationDebug?.hoursSinceLastGeneration ?? 0).toFixed(1)}h
            </Text>
            <Text style={styles.levelDebugLine}>
              lastGeneratedContractsCount: {contractGenerationDebug?.lastGeneratedContractsCount ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              expiredContractsRemoved: {contractGenerationDebug?.expiredContractsRemoved ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              nextGenerationInHours (küçük): {(contractGenerationDebug?.nextSmallGenerationInHours ?? 0).toFixed(1)}h
            </Text>
            <Text style={styles.levelDebugLine}>
              nextMarketRefreshInHours: {(contractGenerationDebug?.nextMediumGenerationInHours ?? 0).toFixed(1)}h
            </Text>
            <Text style={styles.levelDebugLine}>
              nextDailyCleanupInHours: {(contractGenerationDebug?.nextDailyCleanupInHours ?? 0).toFixed(1)}h
            </Text>
            <Text style={styles.levelDebugLine}>
              elapsedSmallTicks: {contractGenerationDebug?.elapsedSmallTicks ?? 0} / processed:{' '}
              {contractGenerationDebug?.processedSmallTicks ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              elapsedMediumTicks: {contractGenerationDebug?.elapsedMediumTicks ?? 0} / processed:{' '}
              {contractGenerationDebug?.processedMediumTicks ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              elapsedDailyTicks: {contractGenerationDebug?.elapsedDailyTicks ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              generatedContractsCount: {contractGenerationDebug?.generatedContractsCount ?? 0}
            </Text>
            <Text style={styles.levelDebugLine}>
              offlineCatchup: {contractGenerationDebug?.offlineCatchup ? 'yes' : 'no'}
            </Text>
            <Text style={styles.levelDebugLine}>— Oyuncu odaklı üretim —</Text>
            <Text style={styles.levelDebugLine}>
              idleTruckCities: {idleTruckCities.join(', ') || '—'}
            </Text>
            <Text style={styles.levelDebugLine}>
              activeDeliveryDestinationCities:{' '}
              {activeDeliveryDestinationCities.join(', ') || '—'}
            </Text>
            <Text style={styles.levelDebugLine}>
              playableContractsCount: {playableContractsCount}
            </Text>
            <Text style={styles.levelDebugLine}>
              contractsByOriginCity:{' '}
              {Object.entries(contractsByOriginCity)
                .map(([cityId, count]) => `${cityId}:${count}`)
                .join(', ') || '—'}
            </Text>
            <Text style={styles.levelDebugLine}>
              lastPlayableContractGeneratedTime:{' '}
              {lastPlayableContractGeneratedTime ?? contractGenerationDebug?.lastPlayableContractGeneratedTime ?? 0}
              h
            </Text>
            <Text style={styles.levelDebugLine}>— Ekonomi dengesi —</Text>
            <Text style={styles.levelDebugLine}>
              averageContractPayment: {formatMoney(contractEconomyDebug?.averageContractPayment ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              averageEstimatedCost: {formatMoney(contractEconomyDebug?.averageEstimatedCost ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              averageEstimatedNetProfit:{' '}
              {formatMoney(contractEconomyDebug?.averageEstimatedNetProfit ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              averageMarginPercent: {contractEconomyDebug?.averageMarginPercent ?? 0}%
            </Text>
            <Text style={styles.levelDebugLine}>
              level1ContractPaymentRange:{' '}
              {formatMoney(contractEconomyDebug?.level1ContractPaymentMin ?? 0)} –{' '}
              {formatMoney(contractEconomyDebug?.level1ContractPaymentMax ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              level1MarginRange: {contractEconomyDebug?.level1MarginMin ?? 0}% –{' '}
              {contractEconomyDebug?.level1MarginMax ?? 0}%
            </Text>
          </View>
          <View style={styles.buttonGrid}>
            <DebugButton
              label="Uygun İş Üret"
              onPress={() => {
                const created = forceGeneratePlayableContracts();
                setInfo(created > 0 ? `${created} alınabilir iş üretildi` : 'Üretilemedi');
              }}
              variant="primary"
            />
            <DebugButton
              label="Refresh Contracts"
              onPress={() => {
                refreshContractsFromMarket();
                setInfo('Contracts refreshed from market');
              }}
            />
            <DebugButton label="Sözleşme Üret (Debug)" onPress={handleGenerateContracts} variant="primary" />
          </View>
        </Section>

        <Section title="Teslimat Para Mutabakatı (Debug)">
          <View style={styles.levelDebugPanel}>
            <Text style={styles.levelDebugLine}>phase: {deliverySettlementDebug?.phase ?? '—'}</Text>
            <Text style={styles.levelDebugLine}>
              cashBefore: {formatMoney(deliverySettlementDebug?.cashBefore ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              cashAfter: {formatMoney(deliverySettlementDebug?.cashAfter ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              fuelCost: {formatMoney(deliverySettlementDebug?.fuelCost ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              payment: {formatMoney(deliverySettlementDebug?.contractPayment ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              maintenanceCost: {formatMoney(deliverySettlementDebug?.maintenanceCost ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              penaltyCost: {formatMoney(deliverySettlementDebug?.penaltyCost ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              reportedNetProfit: {formatMoney(deliverySettlementDebug?.reportedNetProfit ?? 0)}
            </Text>
            <Text style={styles.levelDebugLine}>
              cashDeltaOnCompletion: {formatMoney(deliverySettlementDebug?.cashDeltaOnCompletion ?? 0)}
            </Text>
          </View>
        </Section>

        {/* Game State Summary */}
        <View style={styles.kpiGrid}>
          <KpiCard label="Current Time" value={formatTime(currentTime)} accentColor={COLORS.primary} />
          <KpiCard label="Cash" value={formatMoney(cash)} accentColor={COLORS.success} />
          <KpiCard label="Cities Count" value={`${cities.length}`} accentColor={COLORS.secondary} />
          <KpiCard label="Products Count" value={`${products.length}`} accentColor={COLORS.secondary} />
          <KpiCard label="Routes Count" value={`${routes.length}`} accentColor={COLORS.secondary} />
          <KpiCard label="Total Contracts" value={`${contracts.length}`} accentColor={COLORS.primary} />
          <KpiCard
            label="Available Contracts"
            value={`${countContractsByStatus(contracts, 'available')}`}
            accentColor={COLORS.primary}
          />
          <KpiCard
            label="Active Contracts"
            value={`${countContractsByStatus(contracts, 'active')}`}
            accentColor={COLORS.secondary}
          />
          <KpiCard
            label="Completed Contracts"
            value={`${countContractsByStatus(contracts, 'completed')}`}
            accentColor={COLORS.success}
          />
          <KpiCard
            label="Expired Contracts"
            value={`${countContractsByStatus(contracts, 'expired')}`}
            accentColor={COLORS.textMuted}
          />
          <KpiCard
            label="Failed Contracts"
            value={`${countContractsByStatus(contracts, 'failed')}`}
            accentColor={COLORS.danger}
          />
          <KpiCard label="Active Deliveries" value={`${activeDeliveries.length}`} accentColor={COLORS.secondary} />
          <KpiCard label="Trucks" value={`${trucks.length}`} accentColor={COLORS.primary} />
          <KpiCard label="Drivers" value={`${drivers.length}`} accentColor={COLORS.primary} />
          <KpiCard label="Warehouses" value={`${warehouses.length}`} accentColor={COLORS.primary} />
          <KpiCard label="Inventory Tons" value={`${totalInventoryTons.toFixed(1)}`} accentColor={COLORS.secondary} />
          <KpiCard label="Warehouse Used Cap." value={`${totalUsedCapacity.toFixed(1)}t`} accentColor={COLORS.secondary} />
          <KpiCard label="Trade Purchases" value={`$${Math.round(tradeSummary.tradePurchaseTotal)}`} accentColor={COLORS.danger} />
          <KpiCard label="Trade Sales" value={`$${Math.round(tradeSummary.tradeSaleTotal)}`} accentColor={COLORS.success} />
          <KpiCard label="Trade Net Profit" value={`$${Math.round(tradeSummary.tradeNetProfit)}`} accentColor={COLORS.primary} />
          <KpiCard label="Market News Count" value={`${marketNews.length}`} accentColor={COLORS.secondary} />
          <KpiCard label="Event Log Count" value={`${eventLog.length}`} accentColor={COLORS.primary} />
        </View>

        <Section title="Delivery Integrity">
          <View style={styles.saveStatusCard}>
            <View style={styles.statGrid}>
              <StatItem label="Active Deliveries" value={`${deliveryIntegrity.activeCount}`} />
              <StatItem
                label="Invalid Progress"
                value={`${deliveryIntegrity.invalidProgressCount}`}
                color={deliveryIntegrity.invalidProgressCount > 0 ? COLORS.danger : COLORS.success}
              />
              <StatItem
                label="Missing Truck"
                value={`${deliveryIntegrity.missingTruckCount}`}
                color={deliveryIntegrity.missingTruckCount > 0 ? COLORS.danger : COLORS.success}
              />
              <StatItem
                label="Missing Driver"
                value={`${deliveryIntegrity.missingDriverCount}`}
                color={deliveryIntegrity.missingDriverCount > 0 ? COLORS.danger : COLORS.success}
              />
              <StatItem
                label="Missing Contract"
                value={`${deliveryIntegrity.missingContractCount}`}
                color={deliveryIntegrity.missingContractCount > 0 ? COLORS.danger : COLORS.success}
              />
            </View>
          </View>
        </Section>

        <Section title={`Game Event Log (${recentEvents.length}/${eventLog.length})`}>
          {recentEvents.length === 0 ? (
            <Text style={styles.emptyText}>No game events recorded yet.</Text>
          ) : (
            recentEvents.map((event: GameEvent) => (
              <View
                key={event.id}
                style={[styles.itemCard, { borderLeftColor: getImportanceColor(event.importance), borderLeftWidth: 3 }]}
              >
                <View style={styles.eventHeaderRow}>
                  <Text style={styles.itemTitle} numberOfLines={1}>
                    {event.title}
                  </Text>
                  <Text style={[styles.eventTypeBadge, { color: getImportanceColor(event.importance) }]}>
                    {event.type}
                  </Text>
                </View>
                <Text style={styles.itemSubtext} numberOfLines={2}>
                  {event.message}
                </Text>
                <Text style={styles.eventMetaText}>
                  t={formatTime(event.time)} · {event.importance}
                </Text>
              </View>
            ))
          )}
        </Section>

        <Section title="Company Score">
          <View style={styles.saveStatusCard}>
            <View style={styles.statGrid}>
              <StatItem
                label="Total Score"
                value={formatCompanyScore(companyScore)}
                color={COLORS.primary}
              />
              <StatItem
                label="Ranked Eligible"
                value={companyScoreBreakdown.rankedEligible ? 'yes' : 'no'}
                color={companyScoreBreakdown.rankedEligible ? COLORS.success : COLORS.danger}
              />
              <StatItem
                label="Delivery Score"
                value={formatCompanyScore(companyScoreBreakdown.deliveryScore)}
                color={COLORS.success}
              />
              <StatItem
                label="Progression Score"
                value={formatCompanyScore(companyScoreBreakdown.progressionScore)}
                color={COLORS.secondary}
              />
              <StatItem
                label="Reputation Score"
                value={formatCompanyScore(companyScoreBreakdown.reputationScore)}
                color={COLORS.success}
              />
              <StatItem
                label="Asset Score"
                value={formatCompanyScore(companyScoreBreakdown.assetScore)}
                color={COLORS.secondary}
              />
              <StatItem
                label="Finance Score"
                value={formatCompanyScore(companyScoreBreakdown.financeScore)}
                color={COLORS.success}
              />
              <StatItem
                label="Weekly Activity"
                value={formatCompanyScore(companyScoreBreakdown.weeklyActivityScore)}
                color={COLORS.success}
              />
              <StatItem
                label="Penalty Effect"
                value={formatCompanyScore(companyScoreBreakdown.penaltyScore)}
                color={COLORS.danger}
              />
              <StatItem
                label="1st Prestige"
                value={leaderboardConfig.prestigeLabels[1]}
                color={COLORS.primary}
              />
              <StatItem
                label="2nd Prestige"
                value={leaderboardConfig.prestigeLabels[2]}
                color={COLORS.primary}
              />
              <StatItem
                label="3rd Prestige"
                value={leaderboardConfig.prestigeLabels[3]}
                color={COLORS.primary}
              />
              <StatItem
                label="Economic Rewards"
                value={leaderboardConfig.rewardsEnabled ? 'enabled' : 'disabled'}
                color={leaderboardConfig.rewardsEnabled ? COLORS.danger : COLORS.success}
              />
            </View>
          </View>
          <Text style={styles.debugNoteText}>
            TODO: Weekly leaderboard prestige and ranking will be handled by Firebase
            backend / Cloud Functions.
          </Text>
        </Section>

        {/* TODO: Hide Save Status debug panel in production builds. */}
        <Section title="Bulut Kaydı">
          <View style={styles.saveStatusCard}>
            <View style={styles.statGrid}>
              <StatItem
                label="Bulut Kaydı"
                value={cloudSaveInfo.statusLabel}
                color={
                  cloudSaveInfo.status === 'success'
                    ? COLORS.success
                    : cloudSaveInfo.status === 'failed'
                      ? COLORS.danger
                      : cloudSaveInfo.status === 'syncing' || cloudSaveInfo.status === 'pending'
                        ? COLORS.primary
                        : COLORS.textMuted
                }
              />
              <StatItem
                label="Firebase"
                value={cloudSaveInfo.firebaseEnabled ? 'Aktif' : 'Kapalı'}
                color={cloudSaveInfo.firebaseEnabled ? COLORS.success : COLORS.textMuted}
              />
              <StatItem
                label="User ID"
                value={
                  cloudSaveInfo.uid
                    ? `${cloudSaveInfo.uid.slice(0, 8)}…`
                    : '—'
                }
                color={cloudSaveInfo.uid ? COLORS.secondary : COLORS.textMuted}
              />
              <StatItem
                label="Son Sync"
                value={formatSavedAt(cloudSaveInfo.lastSyncAt)}
                color={cloudSaveInfo.lastSyncAt ? COLORS.secondary : COLORS.textMuted}
              />
              <StatItem
                label="Cloud Error"
                value={cloudSaveInfo.lastError ?? '—'}
                color={cloudSaveInfo.lastError ? COLORS.danger : COLORS.textMuted}
              />
            </View>
            <Text style={styles.debugNoteText}>
              Cloud restore bu fazda kapalı. Local save ana kaynaktır.
            </Text>
          </View>
        </Section>

        <Section title="Save Status">
          <View style={styles.saveStatusCard}>
            <DebugButton
              label="Test Kaydını Sıfırla"
              onPress={handleResetTestSave}
              variant="danger"
            />
            <Text style={styles.debugNoteText}>
              AsyncStorage kaydını siler, tutorial ve görevleri sıfırlar, yeni oyun başlatır.
            </Text>
            <View style={styles.statGrid}>
              <StatItem
                label="Game Day"
                value={`G${debugSaveInfo.gameDay}`}
                color={COLORS.secondary}
              />
              <StatItem
                label="Current Time"
                value={`${debugSaveInfo.currentTime.toFixed(1)}h`}
                color={COLORS.secondary}
              />
              <StatItem
                label="Has Hydrated"
                value={debugSaveInfo.hasHydrated ? 'Yes' : 'No'}
                color={debugSaveInfo.hasHydrated ? COLORS.success : COLORS.danger}
              />
              <StatItem
                label="Has Saved Game"
                value={debugSaveInfo.hasSavedGame ? 'Yes' : 'No'}
                color={debugSaveInfo.hasSavedGame ? COLORS.success : COLORS.textMuted}
              />
              <StatItem
                label="Tutorial Step"
                value={debugTutorialStepId}
                color={COLORS.primary}
              />
              <StatItem
                label="Tutorial Done"
                value={
                  debugTutorialCompleted.length > 0
                    ? debugTutorialCompleted.join(', ')
                    : '—'
                }
                color={COLORS.secondary}
              />
              <StatItem
                label="Missions Done"
                value={
                  debugMissionsCompleted.length > 0 ? debugMissionsCompleted.join(', ') : '—'
                }
                color={COLORS.secondary}
              />
              <StatItem
                label="Rewards Claimed"
                value={
                  debugMissionsClaimed.length > 0 ? debugMissionsClaimed.join(', ') : '—'
                }
                color={COLORS.secondary}
              />
            </View>
          </View>
          <View style={styles.saveStatusCard}>
            <View style={styles.statGrid}>
              <StatItem
                label="Spotlight Done"
                value={
                  debugSaveInfo.spotlightCompletedIds.length > 0
                    ? debugSaveInfo.spotlightCompletedIds.join(', ')
                    : '—'
                }
                color={COLORS.secondary}
              />
              <StatItem
                label="Spotlight Skipped"
                value={
                  debugSaveInfo.spotlightSkippedIds.length > 0
                    ? debugSaveInfo.spotlightSkippedIds.join(', ')
                    : '—'
                }
                color={COLORS.secondary}
              />
              <StatItem
                label="Save Exists"
                value={saveStatus.hasSave ? 'Yes' : 'No'}
                color={saveStatus.hasSave ? COLORS.success : COLORS.textMuted}
              />
              <StatItem
                label="Valid Save"
                value={saveStatus.hasValidSave ? 'Yes' : 'No'}
                color={saveStatus.hasValidSave ? COLORS.success : COLORS.danger}
              />
              <StatItem
                label="Last Save"
                value={formatSavedAt(saveStatus.lastSavedAt)}
                color={saveStatus.lastSavedAt ? COLORS.secondary : COLORS.textMuted}
              />
              <StatItem
                label="Auto Save"
                value={saveStatus.autoSaveEnabled ? 'ON' : 'OFF'}
                color={saveStatus.autoSaveEnabled ? COLORS.success : COLORS.danger}
              />
              <StatItem
                label="Dirty State"
                value={saveStatus.isDirty ? 'Yes' : 'No'}
                color={saveStatus.isDirty ? COLORS.primary : COLORS.textMuted}
              />
              <StatItem
                label="Save Version"
                value={`v${saveStatus.saveVersion}`}
                color={COLORS.secondary}
              />
              <StatItem
                label="Migrated From"
                value={
                  saveStatus.migratedFromVersion != null
                    ? `v${saveStatus.migratedFromVersion}`
                    : '—'
                }
                color={COLORS.secondary}
              />
              <StatItem
                label="Loading Save"
                value={saveStatus.isLoadingSave ? 'Yes' : 'No'}
                color={saveStatus.isLoadingSave ? COLORS.primary : COLORS.textMuted}
              />
              <StatItem
                label="Backup Invalid"
                value={saveStatus.backup?.invalid ? 'Yes' : 'No'}
                color={saveStatus.backup?.invalid ? COLORS.danger : COLORS.textMuted}
              />
              <StatItem
                label="Backup Migrated"
                value={saveStatus.backup?.migrated ? 'Yes' : 'No'}
                color={saveStatus.backup?.migrated ? COLORS.secondary : COLORS.textMuted}
              />
              <StatItem
                label="Last Save Error"
                value={saveStatus.lastSaveError ?? saveError ?? '—'}
                color={saveStatus.lastSaveError || saveError ? COLORS.danger : COLORS.textMuted}
              />
              <StatItem
                label="Game Ready"
                value={isGameReady ? 'Yes' : 'No'}
                color={isGameReady ? COLORS.success : COLORS.textMuted}
              />
              <StatItem
                label="Saving"
                value={saveStatus.isSaving ? 'Yes' : 'No'}
                color={saveStatus.isSaving ? COLORS.primary : COLORS.textMuted}
              />
              <StatItem
                label="Last Reason"
                value={saveStatus.lastSaveReason ?? '—'}
                color={COLORS.secondary}
              />
              <StatItem
                label="Game Time"
                value={formatTime(currentTime)}
                color={COLORS.secondary}
              />
            </View>
          </View>
          <Text style={styles.debugNoteText}>
            Manual save/load controls are debug-only. Player screens use automatic save only.
          </Text>
          <View style={styles.buttonGrid}>
            <DebugButton label="Save Now" onPress={() => void handleSaveNow()} variant="primary" />
            <DebugButton label="Load Save" onPress={() => void handleLoadSave()} />
            <DebugButton label="Clear Save" onPress={() => void handleClearSave()} variant="danger" />
          </View>
        </Section>

        {/* Time Controls */}
        <Section title="Time Controls">
          <View style={styles.buttonGrid}>
            <DebugButton label="Advance 1 Hour" onPress={() => handleAdvanceTime(1)} />
            <DebugButton label="Advance 6 Hours" onPress={() => handleAdvanceTime(6)} />
            <DebugButton label="Advance 12 Hours" onPress={() => handleAdvanceTime(12)} />
            <DebugButton label="Advance 24 Hours" onPress={() => handleAdvanceTime(24)} />
            <DebugButton label="Run 7 Days Simulation" onPress={handleRun7Days} variant="primary" />
            <DebugButton label="Pause" onPress={() => { pauseGame(); setInfo('Game paused'); }} />
            <DebugButton label="Resume" onPress={() => { resumeGame(); setInfo('Game resumed'); }} />
            <DebugButton
              label="Reset Game"
              onPress={handleResetGame}
              variant="danger"
            />
          </View>
        </Section>

        {/* Economy Controls */}
        <Section title="Economy Controls">
          <View style={styles.buttonGrid}>
            <DebugButton label="Run Economy Tick" onPress={handleRunEconomyTick} variant="primary" />
            <DebugButton label="Generate Contracts" onPress={handleGenerateContracts} />
            <DebugButton
              label="Expire Contracts"
              onPress={() => {
                expireContracts();
                setSuccess('Expired old contracts');
              }}
            />
            <DebugButton
              label="Update Fuel Price"
              onPress={() => {
                refuelOrUpdateFuelPrice();
                const price = useGameStore.getState().globalEconomy.fuelPrice;
                setSuccess(`Fuel price updated: $${price.toFixed(2)}/L`);
              }}
            />
            <DebugButton
              label="Clear Old Market News"
              onPress={() => {
                clearOldMarketNews();
                setSuccess('Cleared old market news');
              }}
            />
            <DebugButton
              label="Clear Old Game Events"
              onPress={() => {
                clearOldGameEvents();
                setSuccess('Cleared old game events');
              }}
            />
          </View>
        </Section>

        {/* Contract Test Panel */}
        <Section title={`Contract Test Panel (${previewContracts.length}/${availableContracts.length})`}>
          {previewContracts.length === 0 ? (
            <Text style={styles.emptyText}>No available contracts. Run economy tick or generate contracts.</Text>
          ) : (
            previewContracts.map((contract) => (
              <View key={contract.id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>
                  {getCityName(contract.originCityId)} → {getCityName(contract.destinationCityId)}
                </Text>
                <View style={styles.statGrid}>
                  <StatItem label="Product" value={getProductName(contract.productId)} />
                  <StatItem label="Amount" value={formatTons(contract.amount)} />
                  <StatItem label="Payment" value={formatMoney(contract.payment ?? 0)} color={COLORS.success} />
                  <StatItem label="Deadline" value={`${contract.deadlineHours.toFixed(0)}h`} />
                  <StatItem label="Distance" value={formatDistance(contract.distanceKm)} />
                  <StatItem label="Status" value={contract.status.toUpperCase()} />
                </View>
                <DebugButton
                  label="Start Test Delivery"
                  onPress={() => handleStartTestDelivery(contract)}
                  variant="primary"
                />
              </View>
            ))
          )}
        </Section>

        {/* Active Delivery Test Panel */}
        <Section title={`Active Delivery Test Panel (${activeDeliveries.length})`}>
          {__DEV__ ? (
            <View style={styles.buttonGrid}>
              <DebugButton
                label="Teslimata Hızlı Müdahale Olayı Ekle"
                onPress={() => handleInjectDeliveryIncident()}
                variant="primary"
              />
              <DebugButton
                label="traffic"
                onPress={() => handleInjectDeliveryIncident('traffic')}
              />
              <DebugButton
                label="driver_break"
                onPress={() => handleInjectDeliveryIncident('driver_break')}
              />
              <DebugButton
                label="tire_pressure"
                onPress={() => handleInjectDeliveryIncident('tire_pressure')}
              />
              <DebugButton
                label="fuel_deviation"
                onPress={() => handleInjectDeliveryIncident('fuel_deviation')}
              />
              <DebugButton
                label="checkpoint"
                onPress={() => handleInjectDeliveryIncident('checkpoint')}
              />
            </View>
          ) : null}
          {__DEV__ ? (
            <Text style={styles.levelDebugLine}>
              running deliveries: {runningDeliveries.length}
              {runningDeliveries[0]?.incident?.status
                ? ` · incident: ${runningDeliveries[0].incident?.title} (${runningDeliveries[0].incident?.status})`
                : ''}
            </Text>
          ) : null}
          {activeDeliveries.length === 0 ? (
            <Text style={styles.emptyText}>No active deliveries.</Text>
          ) : (
            activeDeliveries.map((delivery) => (
              <View key={delivery.id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>
                  {getCityName(delivery.originCityId)} → {getCityName(delivery.destinationCityId)}
                </Text>
                <Text style={styles.itemSubtext}>
                  {getProductName(delivery.productId)} • {formatTons(delivery.amount)}
                </Text>
                <ProgressBar progress={delivery.progress} color={COLORS.secondary} />
                <View style={styles.statGrid}>
                  <StatItem label="Progress" value={formatPercent(delivery.progress)} />
                  <StatItem label="Status" value={delivery.status.toUpperCase()} />
                  <StatItem label="Fuel Cost" value={formatMoney(delivery.fuelCost ?? 0)} color={COLORS.danger} />
                  <StatItem
                    label="Est. Profit"
                    value={formatMoney(delivery.estimatedProfit ?? 0)}
                    color={COLORS.success}
                  />
                  <StatItem
                    label="Breakdown"
                    value={formatPercent(delivery.breakdownChance ?? 0)}
                  />
                  <StatItem label="Accident" value={formatPercent(delivery.accidentChance ?? 0)} />
                </View>
                <View style={styles.inlineActionsRow}>
                  <DebugButton label="Complete Now" onPress={() => handleCompleteNow(delivery)} variant="primary" />
                  <DebugButton label="Fail Now" onPress={() => handleFailNow(delivery)} variant="danger" />
                </View>
              </View>
            ))
          )}
        </Section>

        {/* City Economy Snapshot */}
        <Section title={`City Economy Snapshot (${citySnapshot.length})`}>
          {citySnapshot.map((city) => {
            const criticalProducts = getCriticalProducts(city);
            return (
              <View key={city.id} style={styles.itemCard}>
                <Text style={styles.itemTitle}>{city.name}</Text>
                <View style={styles.statGrid}>
                  <StatItem
                    label="Critical Shortages"
                    value={`${countCityShortages(city)}`}
                    color={COLORS.danger}
                  />
                  <StatItem
                    label="High Surpluses"
                    value={`${countCitySurpluses(city)}`}
                    color={COLORS.success}
                  />
                  <StatItem
                    label="Avg Price Mult."
                    value={`${calculateCityAveragePriceMultiplier(city).toFixed(2)}x`}
                  />
                  <StatItem label="Total Stock" value={formatTons(calculateCityTotalStock(city))} />
                  <StatItem label="Total Target" value={formatTons(calculateCityTotalTargetStock(city))} />
                </View>

                <Text style={styles.subSectionTitle}>Most Critical Products</Text>
                {criticalProducts.map((row) => (
                  <View key={row.productId} style={styles.productRow}>
                    <Text style={styles.productRowName}>{getProductName(row.productId)}</Text>
                    <Text style={styles.productRowMeta}>
                      {formatTons(row.stock)} / {formatTons(row.targetStock)} • {formatPercent(row.stockRatio)} •{' '}
                      {formatMoney(row.price)}
                    </Text>
                  </View>
                ))}
              </View>
            );
          })}
        </Section>

        {/* Store Integrity Checks */}
        <Section title="Store Integrity Checks">
          {integrityChecks.map((check) => (
            <View key={check.label} style={styles.integrityRow}>
              <Text style={styles.integrityLabel}>{check.label}</Text>
              <View style={styles.integrityRight}>
                {check.detail ? <Text style={styles.integrityDetail}>{check.detail}</Text> : null}
                <Text style={[styles.integrityStatus, { color: getIntegrityColor(check.status) }]}>
                  {check.status}
                </Text>
              </View>
            </View>
          ))}
        </Section>
      </ScrollView>
    </View>
  );
}

/** Mesafe formatı — helper listesinde ayrıca istenmedi ama contract kartında kullanılır */
function formatDistance(km: number): string {
  return `${Math.round(km)} km`;
}

// ---------------------------------------------------------------------------
// Stiller
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  loadingText: {
    color: COLORS.textSecondary,
    fontSize: 16,
  },

  // Header
  header: {
    marginBottom: 12,
  },
  title: {
    color: COLORS.primary,
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  subtitle: {
    color: COLORS.textSecondary,
    fontSize: 13,
    marginTop: 2,
  },
  headerStatsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 12,
  },
  headerStatBadge: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginRight: 8,
    marginBottom: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  headerStatValue: {
    fontSize: 13,
    fontWeight: '800',
  },
  headerStatLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 2,
  },

  // Message banner
  messageBanner: {
    backgroundColor: COLORS.cardAlt,
    borderRadius: 10,
    borderWidth: 1,
    padding: 10,
    marginBottom: 14,
  },
  messageText: {
    fontSize: 13,
    fontWeight: '700',
  },

  // KPI grid
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  kpiCard: {
    width: '48%',
    backgroundColor: COLORS.card,
    borderRadius: 14,
    borderWidth: 1,
    padding: 12,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.35,
    shadowRadius: 5,
    elevation: 4,
  },
  kpiLabel: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginBottom: 6,
  },
  kpiValue: {
    fontSize: 16,
    fontWeight: '800',
  },

  // Section
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    color: COLORS.textPrimary,
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  subSectionTitle: {
    color: COLORS.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginTop: 8,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  emptyText: {
    color: COLORS.textMuted,
    fontSize: 13,
    fontStyle: 'italic',
  },
  debugNoteText: {
    color: COLORS.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginBottom: 10,
  },
  saveStatusCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  // Stat grid
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: 6,
    marginBottom: 4,
  },
  statItem: {
    width: '33%',
    marginBottom: 10,
  },
  statLabel: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginBottom: 2,
  },
  statValue: {
    fontSize: 13,
    fontWeight: '700',
  },

  // Progress bar
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
    marginTop: 6,
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },

  // Item card
  itemCard: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  itemTitle: {
    color: COLORS.textPrimary,
    fontSize: 14,
    fontWeight: '700',
  },
  itemSubtext: {
    color: COLORS.textSecondary,
    fontSize: 12,
    marginTop: 4,
  },
  eventHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  eventTypeBadge: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  eventMetaText: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginTop: 6,
  },

  levelDebugPanel: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 14,
    gap: 6,
  },
  levelDebugLine: {
    color: COLORS.textSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  cashTestPanel: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.success,
    padding: 14,
    marginBottom: 12,
  },
  cashTestLabel: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  cashTestValue: {
    color: COLORS.success,
    fontSize: 22,
    fontWeight: '800',
  },

  // Buttons
  buttonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  debugButton: {
    width: '48%',
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginBottom: 10,
  },
  debugButtonDisabled: {
    opacity: 0.45,
  },
  debugButtonText: {
    color: COLORS.textPrimary,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'center',
  },
  debugButtonTextDisabled: {
    color: COLORS.textMuted,
  },
  inlineActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },

  // Product row
  productRow: {
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    paddingVertical: 6,
  },
  productRowName: {
    color: COLORS.textPrimary,
    fontSize: 13,
    fontWeight: '600',
  },
  productRowMeta: {
    color: COLORS.textMuted,
    fontSize: 11,
    marginTop: 2,
  },

  // Integrity checks
  integrityRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  integrityLabel: {
    color: COLORS.textSecondary,
    fontSize: 13,
    flex: 1,
    marginRight: 8,
  },
  integrityRight: {
    alignItems: 'flex-end',
  },
  integrityDetail: {
    color: COLORS.textMuted,
    fontSize: 10,
    marginBottom: 2,
  },
  integrityStatus: {
    fontSize: 12,
    fontWeight: '800',
  },
});
