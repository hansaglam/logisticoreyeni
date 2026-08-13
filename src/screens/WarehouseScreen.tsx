/**
 * LogistiCore - Depo Ekranı (mobil kompakt)
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';

import { useAppDialog } from '../components/AppDialogProvider';
import AppTutorialHelpButton from '../components/tutorial/AppTutorialHelpButton';
import AppTutorialOverlay from '../components/tutorial/AppTutorialOverlay';
import { AppTutorialTarget } from '../components/tutorial/AppTutorialTarget';
import { useScreenAppTutorial } from '../hooks/useScreenAppTutorial';
import { useTutorialLayoutReady } from '../hooks/useTutorialLayoutReady';
import TradeProductModal from '../components/TradeProductModal';
import WarehouseStockTransferModal from '../components/WarehouseStockTransferModal';
import {
  OwnedWarehousesSection,
  WarehouseInfoBanner,
  WarehouseOpportunitiesSection,
  WarehouseOverviewGrid,
  WarehouseStrategyTips,
  WarehouseTransfersSection,
} from '../components/warehouse';
import { logWarehouseLayout } from '../components/warehouse/warehouseLayoutDebug';
import {
  AppScreen,
  EmptyState,
  IconButton,
} from '../components/ui';
import { useTabBarLayout } from '../hooks/useTabBarLayout';
import {
  getCityProductMarketPrice,
  normalizeWarehouse,
  WAREHOUSE_SELL_SAME_CITY_RULE,
} from '../simulation/trading';
import { getEffectiveSellPrice } from '../simulation/warehouseStorage';
import { useGameStore } from '../store/gameStore';
import { colors, formatMoney, spacing, typography } from '../theme';
import { buildWarehouseScreenViewModel } from '../utils/warehouseScreenViewModel';
import type { ProductId, Warehouse, WarehouseType } from '../types/game';

const STATUS_MESSAGE_TIMEOUT_MS = 3000;

const GUIDE_MESSAGE =
  'Ucuz şehirden al → depola → talep yüksek şehre taşı → sat.\n\n' +
  'Soğuk ürünler (meyve, içecek) Soğuk Depo ve Soğutuculu Dorse ister.\n\n' +
  'Transfer için kaynak şehirde boş kamyon, uyumlu dorse ve müsait şoför gerekir.';

export default function WarehouseScreen() {
  const { width } = useWindowDimensions();
  const { contentBottomPadding } = useTabBarLayout();
  const { alert: showAlert, showDialog } = useAppDialog();

  const player = useGameStore((state) => state.player);
  const cities = useGameStore((state) => state.cities) ?? [];
  const products = useGameStore((state) => state.products) ?? [];
  const currentTime = useGameStore((state) => state.currentTime) ?? 0;
  const financeLedger = useGameStore((state) => state.financeLedger);
  const activeWarehouseStockTransfers = useGameStore(
    (state) => state.activeWarehouseStockTransfers,
  );
  const completedWarehouseStockTransfers = useGameStore(
    (state) => state.completedWarehouseStockTransfers,
  );
  const openWarehouse = useGameStore((state) => state.openWarehouse);
  const upgradeWarehouse = useGameStore((state) => state.upgradeWarehouse);
  const sellProductFromWarehouse = useGameStore((state) => state.sellProductFromWarehouse);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [expandedWarehouseId, setExpandedWarehouseId] = useState<string | null>(null);
  const [tradeModalVisible, setTradeModalVisible] = useState(false);
  const [sellWarehouse, setSellWarehouse] = useState<Warehouse | null>(null);
  const [sellProductId, setSellProductId] = useState<ProductId | null>(null);
  const [transferModalVisible, setTransferModalVisible] = useState(false);
  const [transferWarehouse, setTransferWarehouse] = useState<Warehouse | null>(null);
  const [transferProductId, setTransferProductId] = useState<ProductId | null>(null);
  const { layoutReady, markLayoutReady } = useTutorialLayoutReady();

  const scrollRef = useRef<ScrollView>(null);
  const transfersOffsetRef = useRef(0);
  const opportunitiesOffsetRef = useRef(0);

  useEffect(() => {
    if (!statusMessage) return;
    const timeout = setTimeout(() => setStatusMessage(null), STATUS_MESSAGE_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [statusMessage]);

  const viewModel = useMemo(() => {
    if (!player) return null;
    return buildWarehouseScreenViewModel({
      warehouses: player.warehouses ?? [],
      cities,
      products,
      trucks: player.trucks ?? [],
      trailers: player.trailers ?? [],
      drivers: player.drivers ?? [],
      activeWarehouseStockTransfers,
      financeLedger,
      currentTime,
      playerLevel: Math.max(1, player.level ?? player.companyLevel ?? 1),
      playerMoney: player.money,
    });
  }, [
    player,
    cities,
    products,
    activeWarehouseStockTransfers,
    financeLedger,
    currentTime,
  ]);

  const sellCity = useMemo(
    () => cities.find((city) => city.id === sellWarehouse?.cityId) ?? null,
    [cities, sellWarehouse?.cityId],
  );

  const sellProduct = useMemo(
    () => products.find((product) => product.id === sellProductId) ?? null,
    [products, sellProductId],
  );

  const sellInventoryItem = useMemo(() => {
    if (!sellWarehouse || !sellProductId) return null;
    return normalizeWarehouse(sellWarehouse, currentTime).inventory?.find(
      (item) => item.productId === sellProductId,
    );
  }, [sellWarehouse, sellProductId, currentTime]);

  const findWarehouse = (warehouseId: string): Warehouse | null => {
    return player?.warehouses?.find((item) => item.id === warehouseId) ?? null;
  };

  const scrollTo = (y: number) => {
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true });
  };

  const handleGoToMarket = () => {
    useGameStore.setState({ navigationRequest: { tab: 'market' } });
  };

  const handleShowGuide = () => {
    showAlert('Depo Rehberi', GUIDE_MESSAGE);
  };

  const handleUpgrade = (warehouseId: string) => {
    const warehouse = findWarehouse(warehouseId);
    const card = viewModel?.warehouses.find((item) => item.warehouse.id === warehouseId);
    if (!warehouse || !card) {
      showAlert('Depo bulunamadı', 'Seçilen depo artık mevcut değil.');
      return;
    }

    const preview = card.upgradePreview;
    const money = player?.money ?? 0;

    if (preview.isMaxLevel || preview.nextLevel == null || preview.upgradeCost == null) {
      showAlert('Yükseltme', card.upgradeHelperText ?? 'Bu depo maksimum seviyede.');
      return;
    }

    if (preview.requiredPlayerLevel != null) {
      const playerLevel = Math.max(1, player?.level ?? player?.companyLevel ?? 1);
      if (playerLevel < preview.requiredPlayerLevel) {
        showAlert(
          'Seviye yetersiz',
          `Bu yükseltme için Level ${preview.requiredPlayerLevel} gerekli.`,
        );
        return;
      }
    }

    const afterMoney = money - preview.upgradeCost;
    const body =
      `Seviye: ${preview.currentLevel} → ${preview.nextLevel}\n` +
      `Kapasite: ${Math.round(preview.currentCapacity)} → ${Math.round(preview.nextCapacity ?? 0)} t\n` +
      `Günlük gider: ${formatMoney(preview.currentDailyCost)} → ${formatMoney(preview.nextDailyCost ?? 0)}\n` +
      `Yükseltme maliyeti: ${formatMoney(preview.upgradeCost)}\n` +
      `Mevcut nakit: ${formatMoney(money)}\n` +
      `Yükseltme sonrası: ${formatMoney(afterMoney)}\n\n` +
      (preview.canAfford
        ? 'Mevcut stok korunur.'
        : `Bakiye yetersiz. ${formatMoney(preview.missingMoney)} daha gerekiyor.`);

    showAlert('Depo Yükseltme', body, [
      { text: 'İptal', style: 'cancel' },
      {
        text: preview.canAfford ? 'Yükselt' : 'Bakiye Yetersiz',
        onPress: () => {
          if (!preview.canAfford) {
            showAlert(
              'Bakiye yetersiz',
              `Bu yükseltme için ${formatMoney(preview.missingMoney)} daha gerekiyor.`,
            );
            return;
          }
          const result = upgradeWarehouse(warehouseId);
          if (!result.success) {
            showAlert('Depo yükseltilemedi', result.message ?? 'İşlem tamamlanamadı.');
            return;
          }
          setStatusMessage(result.message ?? 'Depo yükseltildi');
        },
      },
    ]);
  };

  const handleWarehouseMore = (warehouseId: string) => {
    const card = viewModel?.warehouses.find((item) => item.warehouse.id === warehouseId);
    if (!card) return;
    showDialog({
      title: card.cityName,
      message:
        `Tür: ${card.typeLabel}\nSeviye: ${card.level}\nKapasite: ${Math.round(card.usedTons)} / ${Math.round(card.capacityTons)} t\n` +
        `Gerçekleşmemiş kâr: ${formatMoney(card.unrealizedProfit)}\n\n${WAREHOUSE_SELL_SAME_CITY_RULE}`,
      actions: [
        { label: 'Yükselt', onPress: () => handleUpgrade(warehouseId), variant: 'primary' },
        {
          label: 'Detay',
          onPress: () => setExpandedWarehouseId(warehouseId),
          variant: 'secondary',
        },
        { label: 'Piyasaya Git', onPress: handleGoToMarket, variant: 'secondary' },
        { label: 'Kapat', onPress: () => undefined, variant: 'secondary' },
      ],
    });
  };

  const handleOpenWarehouse = (cityId: string, warehouseType: WarehouseType) => {
    const result = openWarehouse(cityId, warehouseType);
    if (!result.success) {
      showAlert('Depo açılamadı', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }
    setStatusMessage(result.message ?? 'Depo açıldı');
  };

  const handleSellStock = (warehouseId: string, productId: string) => {
    const warehouse = findWarehouse(warehouseId);
    if (!warehouse) return;
    setSellWarehouse(warehouse);
    setSellProductId(productId as ProductId);
    setTradeModalVisible(true);
  };

  const handleTransferStock = (warehouseId: string, productId: string) => {
    const warehouse = findWarehouse(warehouseId);
    if (!warehouse) return;
    setTransferWarehouse(warehouse);
    setTransferProductId(productId as ProductId);
    setTransferModalVisible(true);
  };

  const handleManageStock = (warehouseId: string) => {
    setExpandedWarehouseId(warehouseId);
  };

  const handleTransferFromWarehouse = (warehouseId: string) => {
    const card = viewModel?.warehouses.find((item) => item.warehouse.id === warehouseId);
    if (!card) return;
    if (card.stocks.length === 0) {
      showAlert(
        'Taşınacak stok yok',
        'Önce piyasadan ürün satın al, sonra Taşı ile başka şehre gönder.',
        [{ text: 'Piyasaya Git', onPress: handleGoToMarket }, { text: 'Tamam', style: 'cancel' }],
      );
      return;
    }
    if (card.stocks.length === 1) {
      handleTransferStock(warehouseId, card.stocks[0].productId);
      return;
    }
    setExpandedWarehouseId(warehouseId);
    setStatusMessage('Taşımak için bir ürün seç');
  };

  const handleStartTransferEmpty = () => {
    const withStock = viewModel?.warehouses.find((item) => item.stocks.length > 0);
    if (!withStock) {
      showAlert(
        'Önce stok gerekli',
        'Transfer başlatmak için bir depoda ürün olmalı.',
        [{ text: 'Piyasaya Git', onPress: handleGoToMarket }, { text: 'Tamam', style: 'cancel' }],
      );
      return;
    }
    setExpandedWarehouseId(withStock.warehouse.id);
    setStatusMessage('Bir ürün satırından Taşıya bas');
  };

  const handleConfirmSell = (quantity: number) => {
    if (!sellWarehouse || !sellProductId) return;
    const result = sellProductFromWarehouse({
      warehouseId: sellWarehouse.id,
      productId: sellProductId,
      quantity,
    });
    if (!result.success) {
      showAlert('Satış başarısız', result.message ?? 'İşlem tamamlanamadı.');
      return;
    }
    setTradeModalVisible(false);
    setSellWarehouse(null);
    setSellProductId(null);
    setStatusMessage(result.message ?? 'Ürün satıldı');
  };

  if (!player) {
    return (
      <AppScreen embedded>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Oyun başlatılıyor...</Text>
        </View>
      </AppScreen>
    );
  }

  if (cities.length === 0 || products.length === 0) {
    return (
      <AppScreen embedded>
        <EmptyState
          title="Şehir veya ürün verisi yok"
          message="Depo verileri şehir ve ürün bilgilerine bağlıdır."
          icon="warehouse"
        />
      </AppScreen>
    );
  }

  if (!viewModel) {
    return (
      <AppScreen embedded>
        <View style={styles.loadingContainer}>
          <Text style={styles.loadingText}>Depo verileri yükleniyor...</Text>
        </View>
      </AppScreen>
    );
  }

  const limitLabel =
    viewModel.limits.maxCount > 0
      ? `${viewModel.limits.currentCount} / ${viewModel.limits.maxCount} aktif depo`
      : `${viewModel.limits.currentCount} depo`;
  const hasWarehouses = (player.warehouses ?? []).length > 0;

  const warehouseTutorial = useScreenAppTutorial({
    tutorialId: 'warehouses',
    layoutReady,
    blockingModals: tradeModalVisible || transferModalVisible,
    stepOptions: { hasWarehouses },
    scrollRef,
  });

  return (
    <View style={styles.screenRoot}>
      <AppScreen
        scroll
        scrollRef={scrollRef}
        embedded
        scrollBottomPadding={contentBottomPadding}
        onScroll={warehouseTutorial.handleScroll}
        onScrollEndDrag={warehouseTutorial.handleScrollEnd}
        onMomentumScrollEnd={warehouseTutorial.handleScrollEnd}
        scrollEventThrottle={16}
      >
        <View onLayout={markLayoutReady}>
      <View
        style={styles.header}
        onLayout={(event) => {
          logWarehouseLayout({
            width,
            headerHeight: Math.round(event.nativeEvent.layout.height),
          });
        }}
      >
        <AppTutorialTarget tutorialId="warehouses" targetId="warehouse-header" layoutMode="stretch" style={styles.headerText}>
          <Text style={styles.pageTitle}>Depolar</Text>
          <Text style={styles.pageSubtitle} numberOfLines={2}>
            Stoklarını ve şehirler arası ürün akışını yönet
          </Text>
        </AppTutorialTarget>
        <AppTutorialHelpButton {...warehouseTutorial.helpButtonProps} />
        <IconButton
          icon="plus"
          onPress={() => scrollTo(opportunitiesOffsetRef.current)}
          size={20}
          color={colors.textPrimary}
          backgroundColor={colors.accentBlue}
          style={styles.plusBtn}
          accessibilityLabel="Yeni depo aç"
        />
      </View>

      {statusMessage ? (
        <View style={styles.statusToast}>
          <Text style={styles.statusToastText} numberOfLines={1}>
            {statusMessage}
          </Text>
        </View>
      ) : null}

      <WarehouseOverviewGrid
        overview={viewModel.overview}
        onViewTransfers={() => scrollTo(transfersOffsetRef.current)}
      />

      <AppTutorialTarget tutorialId="warehouses" targetId="special-products" layoutMode="stretch">
        <WarehouseInfoBanner onPress={handleShowGuide} />
      </AppTutorialTarget>

      <AppTutorialTarget tutorialId="warehouses" targetId="stock-management" layoutMode="stretch">
        <OwnedWarehousesSection
          warehouses={viewModel.warehouses}
          limitLabel={limitLabel}
          expandedWarehouseId={expandedWarehouseId}
          onToggleWarehouse={(id) =>
            setExpandedWarehouseId((current) => (current === id ? null : id))
          }
          onManageStock={handleManageStock}
          onTransfer={handleTransferFromWarehouse}
          onUpgrade={handleUpgrade}
          onMore={handleWarehouseMore}
          onGoToMarket={handleGoToMarket}
          onSellStock={handleSellStock}
          onTransferStock={handleTransferStock}
          onOpenNewWarehouse={() => scrollTo(opportunitiesOffsetRef.current)}
        />
      </AppTutorialTarget>

      <WarehouseTransfersSection
        activeTransfers={viewModel.activeTransfers}
        completedTransfers={completedWarehouseStockTransfers}
        onStartTransfer={handleStartTransferEmpty}
        sectionRef={(y) => {
          transfersOffsetRef.current = y;
        }}
      />

      <WarehouseOpportunitiesSection
        opportunities={viewModel.opportunities}
        playerMoney={player.money}
        canOpenMore={viewModel.limits.canOpenMore}
        nextLevelForMore={viewModel.limits.nextLevelForMore}
        onOpenWarehouse={handleOpenWarehouse}
        sectionRef={(y) => {
          opportunitiesOffsetRef.current = y;
        }}
      />

      <WarehouseStrategyTips onMore={handleShowGuide} />

      <TradeProductModal
        visible={tradeModalVisible}
        mode="sell"
        city={sellCity}
        product={sellProduct}
        currentPrice={
          sellCity && sellProductId ? getCityProductMarketPrice(sellCity, sellProductId) : 0
        }
        availableStock={0}
        inventoryQuantity={sellInventoryItem?.quantity ?? 0}
        averageBuyPrice={sellInventoryItem?.averageBuyPrice ?? 0}
        inventoryQuality={sellInventoryItem?.quality ?? 100}
        effectiveSellPrice={
          sellCity && sellProductId && sellInventoryItem
            ? getEffectiveSellPrice(
                getCityProductMarketPrice(sellCity, sellProductId),
                sellInventoryItem.quality ?? 100,
              )
            : undefined
        }
        playerCash={player.money}
        onConfirm={handleConfirmSell}
        onClose={() => {
          setTradeModalVisible(false);
          setSellWarehouse(null);
          setSellProductId(null);
        }}
      />

      <WarehouseStockTransferModal
        visible={transferModalVisible}
        sourceWarehouse={transferWarehouse}
        productId={transferProductId}
        onClose={() => {
          setTransferModalVisible(false);
          setTransferWarehouse(null);
          setTransferProductId(null);
        }}
        onStarted={(message) => setStatusMessage(message)}
        onError={(message) => showAlert('Transfer başlatılamadı', message)}
      />
        </View>
      </AppScreen>
      <AppTutorialOverlay {...warehouseTutorial.overlayProps} />
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
  },
  loadingText: {
    ...typography.body,
    color: colors.textSecondary,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    marginBottom: 12,
    gap: 8,
    paddingBottom: 6,
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 0.1,
  },
  pageSubtitle: {
    fontSize: 12,
    fontWeight: '500',
    color: colors.textSecondary,
    marginTop: 2,
    lineHeight: 16,
  },
  plusBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    borderColor: colors.accentBlue,
  },
  statusToast: {
    backgroundColor: colors.successSoft,
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  statusToastText: {
    ...typography.bodySmall,
    color: colors.textPrimary,
    fontWeight: '600',
    fontSize: 12,
  },
});
