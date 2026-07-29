import { financeBalance } from '../config/balance';

export type CashTransactionKind =
  | 'income'
  | 'voluntary-expense'
  | 'mandatory-expense';

export type CashTransactionReason =
  | 'invalid-amount'
  | 'insufficient-funds'
  | 'cash-floor-reached'
  | 'duplicate-transaction';

export interface CashTransactionResult {
  ok: boolean;
  reason?: CashTransactionReason;
  cashBefore: number;
  amount: number;
  requestedAmount: number;
  cashAfter: number;
  referenceId: string;
  transactionId: string;
}

export interface CashCreditPosition {
  cash: number;
  availableCredit: number;
  debt: number;
  creditLimit: number;
  balance: number;
}

export function normalizeCashBalance(value: number): number {
  const safeValue = Number.isFinite(value) ? value : 0;
  return Math.max(financeBalance.minCashBalance, safeValue);
}

/**
 * V1 overdraft görünümü. Player save alanı `money` olarak kalır; kredi/debt
 * değerleri canonical balance üzerinden türetilir ve ayrı mutation yaratmaz.
 */
export function getCashCreditPosition(balance: number): CashCreditPosition {
  const normalized = normalizeCashBalance(balance);
  const creditLimit = Math.abs(Math.min(0, financeBalance.minCashBalance));
  const debt = Math.max(0, -normalized);
  return {
    cash: Math.max(0, normalized),
    availableCredit: Math.max(0, creditLimit - debt),
    debt,
    creditLimit,
    balance: normalized,
  };
}

export function applyCashTransaction(params: {
  currentCash: number;
  amount: number;
  kind: CashTransactionKind;
  referenceId: string;
  transactionId?: string;
  appliedTransactionIds?: Iterable<string>;
}): CashTransactionResult {
  const cashBefore = normalizeCashBalance(params.currentCash);
  const requestedAmount = Number.isFinite(params.amount)
    ? Math.max(0, params.amount)
    : 0;
  const referenceId = params.referenceId.trim() || 'cash-transaction';
  const transactionId =
    params.transactionId?.trim() || `cash:${referenceId}`;
  const alreadyApplied = new Set(params.appliedTransactionIds ?? []);

  if (alreadyApplied.has(transactionId)) {
    return {
      ok: false,
      reason: 'duplicate-transaction',
      cashBefore,
      amount: 0,
      requestedAmount,
      cashAfter: cashBefore,
      referenceId,
      transactionId,
    };
  }

  if (requestedAmount <= 0) {
    return {
      ok: false,
      reason: 'invalid-amount',
      cashBefore,
      amount: 0,
      requestedAmount,
      cashAfter: cashBefore,
      referenceId,
      transactionId,
    };
  }

  if (params.kind === 'income') {
    return {
      ok: true,
      cashBefore,
      amount: requestedAmount,
      requestedAmount,
      cashAfter: cashBefore + requestedAmount,
      referenceId,
      transactionId,
    };
  }

  if (params.kind === 'voluntary-expense') {
    if (cashBefore < requestedAmount) {
      return {
        ok: false,
        reason: 'insufficient-funds',
        cashBefore,
        amount: 0,
        requestedAmount,
        cashAfter: cashBefore,
        referenceId,
        transactionId,
      };
    }
    return {
      ok: true,
      cashBefore,
      amount: requestedAmount,
      requestedAmount,
      cashAfter: cashBefore - requestedAmount,
      referenceId,
      transactionId,
    };
  }

  const maximumDeduction = Math.max(
    0,
    cashBefore - financeBalance.minCashBalance,
  );
  const amount = Math.min(requestedAmount, maximumDeduction);
  return {
    ok: true,
    ...(amount < requestedAmount ? { reason: 'cash-floor-reached' as const } : {}),
    cashBefore,
    amount,
    requestedAmount,
    cashAfter: normalizeCashBalance(cashBefore - amount),
    referenceId,
    transactionId,
  };
}

/** Zorunlu gider/ceza kesintileri — nakit tabanına kadar düşebilir */
export function applyMandatoryCashDeduction(currentMoney: number, cost: number): number {
  return applyCashTransaction({
    currentCash: currentMoney,
    amount: cost,
    kind: 'mandatory-expense',
    referenceId: 'legacy-mandatory-deduction',
  }).cashAfter;
}

/** Gönüllü harcama (alım, kiralama, yakıt) — yeterli pozitif nakit gerekir */
export function canAffordVoluntaryPurchase(money: number, cost: number): boolean {
  if (!Number.isFinite(money) || !Number.isFinite(cost) || cost <= 0) {
    return false;
  }
  return money >= cost;
}
