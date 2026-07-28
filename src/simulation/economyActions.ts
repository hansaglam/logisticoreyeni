/**
 * Server-ready ekonomi action payload'ları — V2 backend doğrulaması için.
 * Client hesapları authoritative değildir.
 */

export interface EconomyActionBase {
  transactionId: string;
  idempotencyKey: string;
  snapshotVersion: number;
  marketEpoch: number;
  clientTimestampMs: number;
  playerId?: string;
}

export interface ContractSettlementAction extends EconomyActionBase {
  type: 'contract_settlement';
  contractId: string;
  deliveryId: string;
  claimedPayment: number;
  claimedCosts: {
    fuel: number;
    driver: number;
    maintenance: number;
    other: number;
  };
}

export interface MarketTradeAction extends EconomyActionBase {
  type: 'market_buy' | 'market_sell';
  cityId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
}

export interface PeriodicCostAction extends EconomyActionBase {
  type: 'periodic_cost';
  periodKeys: string[];
  totalAmount: number;
}

export type EconomyDomainAction =
  | ContractSettlementAction
  | MarketTradeAction
  | PeriodicCostAction;

export function createEconomyActionIds(prefix: string, nowMs: number): {
  transactionId: string;
  idempotencyKey: string;
} {
  const rand = Math.floor(Math.random() * 1_000_000);
  return {
    transactionId: `${prefix}_tx_${nowMs}_${rand}`,
    idempotencyKey: `${prefix}_idem_${nowMs}_${rand}`,
  };
}
