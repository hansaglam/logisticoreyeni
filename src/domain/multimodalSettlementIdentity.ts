/**
 * Multimodal settlement identity + idempotency foundation (Map V2 Step 23).
 *
 * Pure helpers only. Do not pay cash, mutate player state, or call Firebase.
 * Do not import Map V2 screens, Skia, or prototype runtime.
 */

import {
  isExecutablePersistedMultimodalShipment,
  isUnreadablePersistedMultimodalShipment,
  MULTIMODAL_FEATURE_ROLLOUT,
  type PersistedMultimodalShipment,
} from './multimodalShipmentPersistence';

/** Active production kind. No other kind may execute in this step. */
export type MultimodalSettlementKind = 'revenue';

/**
 * Documented future identity suffixes (ADR 0011). Formatting them does not
 * execute settlement. `getMultimodalSettlementId` only activates `revenue`.
 */
export type MultimodalDocumentedSettlementKind =
  | MultimodalSettlementKind
  | 'capacity'
  | 'completion-expenses';

export const MULTIMODAL_SETTLEMENT_NAMESPACE = 'shipment' as const;
export const MULTIMODAL_SETTLEMENT_KIND_REVENUE = 'revenue' as const;
export const MULTIMODAL_COMPLETION_KIND = 'completion' as const;

export const MULTIMODAL_DOCUMENTED_SETTLEMENT_KINDS: readonly MultimodalDocumentedSettlementKind[] =
  ['revenue', 'capacity', 'completion-expenses'];

/** Known legacy ROAD prefixes — never rewritten. Used only for collision proofs. */
export const LEGACY_DELIVERY_SETTLEMENT_ID_PREFIX = 'settlement_';
export const LEGACY_DELIVERY_REVENUE_LEDGER_PREFIX = 'delivery:';
export const LEGACY_DELIVERY_REPUTATION_SETTLEMENT_PREFIX = 'reputation:delivery:';

const MAX_SHIPMENT_ID_LENGTH = 128;
/** Colons are reserved for the `shipment:{id}:{kind}` envelope. */
const VALID_SHIPMENT_ID = /^[A-Za-z0-9._-]+$/;
const VALID_KIND = /^[a-z0-9-]+$/;

export type MultimodalIdentityFailure = {
  ok: false;
  reason: 'INVALID_IDENTITY';
};

export type MultimodalIdentitySuccess = {
  ok: true;
  id: string;
};

export type MultimodalIdentityResult = MultimodalIdentitySuccess | MultimodalIdentityFailure;

export type MultimodalSettlementClassification =
  | 'NOT_SETTLED'
  | 'ALREADY_SETTLED'
  | 'INVALID_IDENTITY'
  | 'UNAUTHORIZED'
  | 'NOT_EXECUTED';

export type MultimodalSettlementAttemptClassification = {
  classification: MultimodalSettlementClassification;
  /** Present only when a valid identity could be derived. Never means money moved. */
  settlementId?: string;
  completionId?: string;
  kind?: string;
  executed: false;
};

/**
 * Future callable contract — type only. Not registered, not deployed, not invoked.
 * Server must treat `settlementId` as the atomic idempotency key when signed in.
 */
export type CompleteMultimodalShipmentRequest = {
  shipmentId: string;
  settlementId: string;
  completionId: string;
};

export type CompleteMultimodalShipmentResult = {
  ok: boolean;
  alreadyApplied?: boolean;
  reason?: MultimodalSettlementClassification;
};

export function isValidMultimodalShipmentId(value: unknown): value is string {
  if (typeof value !== 'string') {
    return false;
  }
  if (value.length < 1 || value.length > MAX_SHIPMENT_ID_LENGTH) {
    return false;
  }
  if (value !== value.trim()) {
    return false;
  }
  return VALID_SHIPMENT_ID.test(value);
}

export function isActiveMultimodalSettlementKind(
  value: unknown,
): value is MultimodalSettlementKind {
  return value === MULTIMODAL_SETTLEMENT_KIND_REVENUE;
}

export function isDocumentedMultimodalSettlementKind(
  value: unknown,
): value is MultimodalDocumentedSettlementKind {
  return (
    typeof value === 'string' &&
    (MULTIMODAL_DOCUMENTED_SETTLEMENT_KINDS as readonly string[]).includes(value)
  );
}

/**
 * Deterministic settlement identity.
 * Same shipmentId + kind ⇒ same string. No Date, randomness, store, or network.
 */
export function getMultimodalSettlementId(
  shipmentId: unknown,
  kind: unknown = MULTIMODAL_SETTLEMENT_KIND_REVENUE,
): MultimodalIdentityResult {
  return buildMultimodalSettlementId(shipmentId, kind);
}

/** Spec alias — identical to getMultimodalSettlementId. */
export function buildMultimodalSettlementId(
  shipmentId: unknown,
  kind: unknown = MULTIMODAL_SETTLEMENT_KIND_REVENUE,
): MultimodalIdentityResult {
  if (!isValidMultimodalShipmentId(shipmentId)) {
    return { ok: false, reason: 'INVALID_IDENTITY' };
  }
  if (typeof kind !== 'string' || !VALID_KIND.test(kind) || !isDocumentedMultimodalSettlementKind(kind)) {
    return { ok: false, reason: 'INVALID_IDENTITY' };
  }
  return { ok: true, id: formatNamespaced(shipmentId, kind) };
}

/**
 * Completion receipt identity — distinct from settlement.
 * Analogous to canonicalDeliveryCompletions using deliveryId, but namespaced so
 * it must never be written into users/{uid}/canonicalDeliveryCompletions/{deliveryId}.
 */
export function getMultimodalCompletionId(shipmentId: unknown): MultimodalIdentityResult {
  if (!isValidMultimodalShipmentId(shipmentId)) {
    return { ok: false, reason: 'INVALID_IDENTITY' };
  }
  return { ok: true, id: formatNamespaced(shipmentId, MULTIMODAL_COMPLETION_KIND) };
}

export function classifyMultimodalSettlementAttempt(input: {
  shipmentId: unknown;
  kind?: unknown;
  alreadyAppliedSettlementIds?: Iterable<string>;
  signedIn?: boolean;
  requireServerAuthority?: boolean;
  shipment?: PersistedMultimodalShipment;
  featureRollout?: string;
}): MultimodalSettlementAttemptClassification {
  const executed = false as const;
  const kind = input.kind ?? MULTIMODAL_SETTLEMENT_KIND_REVENUE;
  const settlement = buildMultimodalSettlementId(input.shipmentId, kind);
  const completion = getMultimodalCompletionId(input.shipmentId);

  if (!settlement.ok || !completion.ok) {
    return { classification: 'INVALID_IDENTITY', executed };
  }

  const kindLabel = typeof kind === 'string' ? kind : undefined;
  const ids = {
    settlementId: settlement.id,
    completionId: completion.id,
    kind: kindLabel,
    executed,
  };

  if (input.shipment && isUnreadablePersistedMultimodalShipment(input.shipment)) {
    return { classification: 'NOT_EXECUTED', ...ids };
  }

  if (input.shipment && !isExecutablePersistedMultimodalShipment(input.shipment)) {
    return { classification: 'NOT_EXECUTED', ...ids };
  }

  if (!isActiveMultimodalSettlementKind(kind)) {
    return { classification: 'NOT_EXECUTED', ...ids };
  }

  const applied = new Set(input.alreadyAppliedSettlementIds ?? []);
  if (applied.has(settlement.id)) {
    return { classification: 'ALREADY_SETTLED', ...ids };
  }

  if (input.requireServerAuthority === true && input.signedIn !== true) {
    return { classification: 'UNAUTHORIZED', ...ids };
  }

  const rollout = input.featureRollout ?? MULTIMODAL_FEATURE_ROLLOUT;
  if (rollout !== 'PRODUCTION_ROLLOUT' && rollout !== 'INTERNAL_TEST') {
    return { classification: 'NOT_EXECUTED', ...ids };
  }

  return { classification: 'NOT_SETTLED', ...ids };
}

/**
 * Derive identities from a persisted shipment. Does not write settlement fields.
 * Unknown/malformed schema ⇒ no executable identity.
 */
export function tryDeriveMultimodalSettlementIdentity(
  shipment: unknown,
): MultimodalSettlementAttemptClassification {
  if (!shipment || typeof shipment !== 'object') {
    return { classification: 'INVALID_IDENTITY', executed: false };
  }
  const record = shipment as PersistedMultimodalShipment;
  if (isUnreadablePersistedMultimodalShipment(record)) {
    return { classification: 'NOT_EXECUTED', executed: false };
  }
  if (!isExecutablePersistedMultimodalShipment(record)) {
    if (!isValidMultimodalShipmentId((shipment as { shipmentId?: unknown }).shipmentId)) {
      return { classification: 'INVALID_IDENTITY', executed: false };
    }
    return { classification: 'NOT_EXECUTED', executed: false };
  }
  return classifyMultimodalSettlementAttempt({
    shipmentId: record.shipmentId,
    shipment: record,
  });
}

export function multimodalSettlementCollidesWithLegacyIdentity(settlementId: string): boolean {
  return (
    settlementId.startsWith(LEGACY_DELIVERY_SETTLEMENT_ID_PREFIX) ||
    settlementId.startsWith(LEGACY_DELIVERY_REVENUE_LEDGER_PREFIX) ||
    settlementId.startsWith(LEGACY_DELIVERY_REPUTATION_SETTLEMENT_PREFIX)
  );
}

function formatNamespaced(shipmentId: string, suffix: string): string {
  return `${MULTIMODAL_SETTLEMENT_NAMESPACE}:${shipmentId}:${suffix}`;
}
