import { financeBalance } from '../config/balance';

/** Zorunlu gider/ceza kesintileri — nakit tabanına kadar düşebilir */
export function applyMandatoryCashDeduction(currentMoney: number, cost: number): number {
  const safeMoney = Number.isFinite(currentMoney) ? currentMoney : 0;
  const safeCost = Number.isFinite(cost) ? Math.max(0, cost) : 0;
  return Math.max(financeBalance.minCashBalance, safeMoney - safeCost);
}

/** Gönüllü harcama (alım, kiralama, yakıt) — yeterli pozitif nakit gerekir */
export function canAffordVoluntaryPurchase(money: number, cost: number): boolean {
  if (!Number.isFinite(money) || !Number.isFinite(cost) || cost <= 0) {
    return false;
  }
  return money >= cost;
}
