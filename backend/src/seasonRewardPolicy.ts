/**
 * Phase 7 Step 9 — Per-season reward designation (server-authoritative).
 *
 * GLOBAL `SEASON_REWARDS_ENABLED` controls whether reward operations run.
 * PER-SEASON designation (this module) decides what freezes into close meta.
 *
 * Designation does NOT depend on the global ops flag — a season may close as
 * reward-enabled while payout backend remains OFF until verification.
 *
 * Fail-closed: absent / empty allowlist ⇒ rewards disabled for every season.
 * Explicit allowlist only — never "enable all future seasons".
 */

import { isValidLeaderboardSeasonKey } from './leaderboardSeason';
import { SEASON_REWARD_CATALOG_VERSION } from './seasonRewardTypes';

/** Backend env: comma-separated ISO week keys (e.g. `2026-W40,2026-W41`). */
export const SEASON_REWARD_ENABLED_SEASONS_ENV = 'SEASON_REWARD_ENABLED_SEASONS';

export type SeasonRewardPolicyReason =
  | 'not-designated'
  | 'designated'
  | 'invalid-season-key'
  | 'unsupported-catalog-version';

export type SeasonRewardPolicy = {
  rewardsEnabled: boolean;
  /** Frozen catalog when rewardsEnabled; otherwise null. */
  rewardCatalogVersion: number | null;
  reason: SeasonRewardPolicyReason;
  /** Whether seasonKey appears in the configured allowlist (before catalog checks). */
  configuredDesignation: boolean;
};

export type SeasonRewardDesignationValidation = {
  ok: boolean;
  seasonKey: string;
  reason:
    | 'ok'
    | 'invalid-season-key'
    | 'not-designated'
    | 'unsupported-catalog-version';
  policy: SeasonRewardPolicy;
};

/**
 * Parse explicit allowlist. Empty / unset ⇒ no seasons designated.
 * Invalid tokens are ignored (fail closed for those keys).
 */
export function parseSeasonRewardEnabledSeasonAllowlist(
  raw: string | undefined | null = process.env[SEASON_REWARD_ENABLED_SEASONS_ENV],
): ReadonlySet<string> {
  if (typeof raw !== 'string' || raw.trim() === '') {
    return new Set();
  }
  const out = new Set<string>();
  for (const token of raw.split(',')) {
    const key = token.trim();
    if (isValidLeaderboardSeasonKey(key)) {
      out.add(key);
    }
  }
  return out;
}

export function isSeasonDesignatedForRewards(
  seasonKey: string,
  allowlist: ReadonlySet<string> = parseSeasonRewardEnabledSeasonAllowlist(),
): boolean {
  return allowlist.has(seasonKey);
}

/**
 * Resolve reward policy for a seasonKey at close initialization (and ops inspect).
 * Independent of `SEASON_REWARDS_ENABLED` global ops flag.
 */
export function resolveSeasonRewardPolicy(
  seasonKey: string,
  options?: {
    /** Override env allowlist (tests). */
    enabledSeasonsRaw?: string | null;
    /** Override supported catalog version (tests). Defaults to SEASON_REWARD_CATALOG_VERSION. */
    supportedCatalogVersion?: number;
  },
): SeasonRewardPolicy {
  if (!isValidLeaderboardSeasonKey(seasonKey)) {
    return {
      rewardsEnabled: false,
      rewardCatalogVersion: null,
      reason: 'invalid-season-key',
      configuredDesignation: false,
    };
  }

  const allowlist = Object.prototype.hasOwnProperty.call(
    options ?? {},
    'enabledSeasonsRaw',
  )
    ? parseSeasonRewardEnabledSeasonAllowlist(options?.enabledSeasonsRaw)
    : parseSeasonRewardEnabledSeasonAllowlist();

  const configuredDesignation = isSeasonDesignatedForRewards(seasonKey, allowlist);
  if (!configuredDesignation) {
    return {
      rewardsEnabled: false,
      rewardCatalogVersion: null,
      reason: 'not-designated',
      configuredDesignation: false,
    };
  }

  const supported =
    options?.supportedCatalogVersion ?? SEASON_REWARD_CATALOG_VERSION;
  if (!Number.isInteger(supported) || supported !== SEASON_REWARD_CATALOG_VERSION) {
    // Fail closed: never freeze an unsupported catalog.
    return {
      rewardsEnabled: false,
      rewardCatalogVersion: null,
      reason: 'unsupported-catalog-version',
      configuredDesignation: true,
    };
  }

  return {
    rewardsEnabled: true,
    rewardCatalogVersion: SEASON_REWARD_CATALOG_VERSION,
    reason: 'designated',
    configuredDesignation: true,
  };
}

/** Fields written create-once into season close meta. */
export function freezeSeasonRewardPolicyFields(policy: SeasonRewardPolicy): {
  rewardsEnabled: boolean;
  rewardCatalogVersion: number | null;
} {
  if (!policy.rewardsEnabled) {
    return { rewardsEnabled: false, rewardCatalogVersion: null };
  }
  return {
    rewardsEnabled: true,
    rewardCatalogVersion: policy.rewardCatalogVersion,
  };
}

/**
 * Lightweight pre-close / ops validation (no I/O).
 * Does not write. Does not flip existing frozen meta.
 */
export function validateSeasonRewardDesignation(
  seasonKey: string,
  options?: Parameters<typeof resolveSeasonRewardPolicy>[1],
): SeasonRewardDesignationValidation {
  const policy = resolveSeasonRewardPolicy(seasonKey, options);
  if (policy.reason === 'invalid-season-key') {
    return { ok: false, seasonKey, reason: 'invalid-season-key', policy };
  }
  if (policy.reason === 'unsupported-catalog-version') {
    return { ok: false, seasonKey, reason: 'unsupported-catalog-version', policy };
  }
  if (!policy.rewardsEnabled) {
    return { ok: true, seasonKey, reason: 'not-designated', policy };
  }
  return { ok: true, seasonKey, reason: 'ok', policy };
}
