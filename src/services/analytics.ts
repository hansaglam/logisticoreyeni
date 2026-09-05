import { V11_ANALYTICS_ENABLED } from '../config/backendRoadmap';

export type V11AnalyticsEventName =
  | 'app_open'
  | 'session_start'
  | 'seasons_screen_view'
  | 'challenge_claim_tap'
  | 'challenge_claim_success'
  | 'challenge_claim_failure'
  | 'driver_level_up'
  | 'achievement_unlocked'
  | 'progress_history_view'
  | 'marketplace_view'
  | 'marketplace_purchase_success'
  | 'marketplace_sale_observed'
  | 'market_alert_open'
  | 'inbox_view'
  | 'inbox_item_open';

export type V11AnalyticsParameters = Readonly<Record<string, string | number | boolean>>;

export interface V11AnalyticsProvider {
  track(event: V11AnalyticsEventName, parameters: V11AnalyticsParameters): void | Promise<void>;
}

const FORBIDDEN_PARAMETER_KEYS = /(?:email|uid|token|authorization|cash|save|device|text|message)/i;
const ALLOWED_PARAMETER_KEYS = new Set([
  'source',
  'result',
  'challenge_type',
  'achievement_id',
  'inbox_type',
  'provider',
]);

let provider: V11AnalyticsProvider | null = null;

export function setV11AnalyticsProvider(next: V11AnalyticsProvider | null): void {
  provider = next;
}

export function validateV11AnalyticsParameters(parameters: V11AnalyticsParameters): boolean {
  return Object.entries(parameters).every(([key, value]) =>
    ALLOWED_PARAMETER_KEYS.has(key) &&
    !FORBIDDEN_PARAMETER_KEYS.test(key) &&
    (typeof value === 'boolean' ||
      (typeof value === 'number' && Number.isFinite(value)) ||
      (typeof value === 'string' && value.length <= 48)),
  );
}

export async function dispatchV11Analytics(
  target: V11AnalyticsProvider,
  event: V11AnalyticsEventName,
  parameters: V11AnalyticsParameters = {},
): Promise<boolean> {
  if (!validateV11AnalyticsParameters(parameters)) return false;
  try {
    await target.track(event, parameters);
    return true;
  } catch {
    return false;
  }
}

/** Analytics is deliberately fail-open and provider-deferred in Phase 4. */
export async function trackV11Analytics(
  event: V11AnalyticsEventName,
  parameters: V11AnalyticsParameters = {},
): Promise<boolean> {
  if (!V11_ANALYTICS_ENABLED || !provider) return false;
  return dispatchV11Analytics(provider, event, parameters);
}
