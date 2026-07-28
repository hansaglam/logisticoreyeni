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
  const { scrollBottomPadding } = useTabBarLayout();
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
    const card = viewModel?.warehouses.find((item) => item.warehouse.id === warehouseId);
    if (!card) return;

    const preview = card.upgradePreview;
    if (preview.nextLevel == null || preview.upgradePrice == null) {
      showAlert('Yükseltme', card.upgradeHelperText ?? 'Bu depo daha fazla yükseltilemez.');
      return;
    }

    const body =
      `Seviye: ${preview.currentLevel} → ${preview.nextLevel}\n` +
      `Kapasite: ${Math.round(preview.currentCapacity)} → ${Math.round(preview.nextCapacity ?? 0)} t\n` +
      `Günlük gider: ${formatMoney(preview.currentDailyCost)} → ${formatMoney(preview.nextDailyCost ?? 0)}\n` +
      `Yükseltme maliyeti: ${formatMoney(preview.upgradePrice)}\n\n` +
      `Mevcut stok korunur.`;

    showAlert('Depo Yükselt', body, [
      { text: 'İptal', style: 'cancel' },
      {
        text: 'Yükselt',
        onPress: () => {
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

  const limitLabel = `${viewModel.limits.currentCount} / ${viewModel.limits.maxCount} depo`;

  return (
    <AppScreen
      scroll
      scrollRef={scrollRef}
      embedded
      scrollBottomPadding={scrollBottomPadding}
    >
      <View
        style={styles.header}
        onLayout={(event) => {
          logWarehouseLayout({
            width,
            headerHeight: Math.round(event.nativeEvent.layout.height),
          });
        }}
      >
        <View style={styles.headerText}>
          <Text style={styles.pageTitle}>Depolar</Text>
          <Text style={styles.pageSubtitle} numberOfLines={1}>
            Stoklarını ve şehirler arası ürün akışını yönet
          </Text>
        </View>
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

      <WarehouseInfoBanner onPress={handleShowGuide} />

      {/* Aktif transfer varken de hemen Depolarım altında kalır */}
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
    </AppScreen>
  );
}

const styles = StyleSheet.create({
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
    minHeight: 56,
    maxHeight: 72,
    marginBottom: 10,
    gap: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(35, 136, 255, 0.18)',
  },
  headerText: {
    flex: 1,
    minWidth: 0,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: 0.2,
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
