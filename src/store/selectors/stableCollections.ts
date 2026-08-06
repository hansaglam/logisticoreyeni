import type { ReputationHistoryEntry } from '../../domain/reputationModel';
import type {
  City,
  Contract,
  Delivery,
  FinanceLedgerEntry,
  Product,
  Route,
  TruckTransfer,
} from '../../types/game';

export const EMPTY_ACTIVE_DELIVERIES: Delivery[] = [];
export const EMPTY_ACTIVE_TRANSFERS: TruckTransfer[] = [];
export const EMPTY_CITIES: City[] = [];
export const EMPTY_CONTRACTS: Contract[] = [];
export const EMPTY_PRODUCTS: Product[] = [];
export const EMPTY_ROUTES: Route[] = [];
export const EMPTY_REPUTATION_HISTORY: ReputationHistoryEntry[] = [];
export const EMPTY_FINANCE_LEDGER: FinanceLedgerEntry[] = [];

export function selectActiveDeliveries(state: {
  activeDeliveries?: Delivery[] | null;
}): Delivery[] {
  return Array.isArray(state.activeDeliveries) ? state.activeDeliveries : EMPTY_ACTIVE_DELIVERIES;
}

export function selectActiveTransfers(state: {
  activeTransfers?: TruckTransfer[] | null;
}): TruckTransfer[] {
  return Array.isArray(state.activeTransfers) ? state.activeTransfers : EMPTY_ACTIVE_TRANSFERS;
}

export function selectCities(state: { cities?: City[] | null }): City[] {
  return Array.isArray(state.cities) ? state.cities : EMPTY_CITIES;
}

export function selectContracts(state: { contracts?: Contract[] | null }): Contract[] {
  return Array.isArray(state.contracts) ? state.contracts : EMPTY_CONTRACTS;
}

export function selectProducts(state: { products?: Product[] | null }): Product[] {
  return Array.isArray(state.products) ? state.products : EMPTY_PRODUCTS;
}

export function selectRoutes(state: { routes?: Route[] | null }): Route[] {
  return Array.isArray(state.routes) ? state.routes : EMPTY_ROUTES;
}

export function selectReputationHistory(state: {
  reputationHistory?: ReputationHistoryEntry[] | null;
}): ReputationHistoryEntry[] {
  return Array.isArray(state.reputationHistory)
    ? state.reputationHistory
    : EMPTY_REPUTATION_HISTORY;
}

export function selectFinanceLedger(state: {
  financeLedger?: FinanceLedgerEntry[] | null;
}): FinanceLedgerEntry[] {
  return Array.isArray(state.financeLedger) ? state.financeLedger : EMPTY_FINANCE_LEDGER;
}
