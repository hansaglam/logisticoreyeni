import type { ProductId } from '../types/game';
import { clampPrice, roundMarketPrice } from './marketEconomyCalculations';
import {
  createSeededRng,
  getMarketStateBias,
  getProductMarketProfile,
  stockRatioToStatusKey,
} from '../utils/productMarketProfile';

export interface MarketPriceTickInput {
  cityId: string;
  productId: ProductId;
  previousPrice: number;
  targetPrice: number;
  basePrice: number;
  stockRatio: number;
  tickIndex: number;
  globalVolatility?: number;
}

/**
 * Ekonomi hedef fiyatına doğru giderken küçük geri çekilmeler ve tepkiler ekler.
 * Deterministik: aynı tick index → aynı mikro hareket.
 */
export function applyMarketPriceMicroMove(input: MarketPriceTickInput): number {
  const previousPrice = Math.max(input.previousPrice, 0.01);
  const targetPrice = Math.max(input.targetPrice, 0.01);
  const basePrice = Math.max(input.basePrice, 0.01);

  const profile = getProductMarketProfile(input.productId);
  const stockStatus = stockRatioToStatusKey(input.stockRatio);
  const bias = getMarketStateBias(stockStatus);

  const globalScale = Math.max(0.5, Math.min(1.5, input.globalVolatility ?? 1));
  const noiseScale = profile.volatility * bias.volatilityMultiplier * globalScale;

  const seed = `${input.cityId}-${input.productId}-tick-${input.tickIndex}`;
  const rng = createSeededRng(seed);

  const targetDelta = (targetPrice - previousPrice) / previousPrice;
  const distanceFromBase = (previousPrice - basePrice) / basePrice;
  const meanReversionForce =
    -distanceFromBase * profile.meanReversion * bias.meanReversionMultiplier;

  const noise = (rng() - 0.5) * 2 * noiseScale * 0.92;

  let counterMove = 0;
  if (rng() < bias.counterTrendBounceChance) {
    const biasSign = bias.directionBias !== 0 ? bias.directionBias : Math.sign(targetDelta) || 1;
    counterMove = -biasSign * noiseScale * (0.3 + rng() * 0.45);
  }

  let shock = 0;
  if (rng() < profile.shockChance) {
    shock = (rng() > 0.5 ? 1 : -1) * noiseScale * (1.3 + rng() * 1.4);
  }

  const biasDrift = bias.directionBias * profile.trendStrength * 0.005;

  const totalChange =
    targetDelta * profile.smoothing +
    meanReversionForce +
    noise +
    counterMove +
    shock +
    biasDrift;

  let nextPrice = previousPrice * (1 + totalChange);

  const gapToTarget = (targetPrice - nextPrice) / targetPrice;
  nextPrice *= 1 + gapToTarget * 0.24;

  return roundMarketPrice(clampPrice(nextPrice, basePrice));
}
