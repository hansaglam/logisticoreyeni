export type LeaderboardFailureReason =
  | 'auth-required'
  | 'anonymous-not-supported'
  | 'save-not-found'
  | 'invalid-player-state'
  | 'invalid-request'
  | 'rate-limited'
  | 'season-closed'
  | 'score-not-improved'
  | 'service-unavailable';

export interface LeaderboardActionIdentity {
  uid: string;
  displayName: string | null;
}

export interface SubmitLeaderboardScoreInput {
  transactionId: string;
  idempotencyKey: string;
  clientSaveVersion?: number;
}

export interface LeaderboardEntryDocument {
  uid: string;
  companyName: string;
  companyScore: number;
  level: number;
  reputation: number;
  completedContracts: number;
  seasonKey: string;
  updatedAt: unknown;
  sourceSaveVersion: number;
  scoreVersion: number;
}

export interface LeaderboardPublicEntry {
  uid: string;
  companyName: string;
  companyScore: number;
  level: number;
  reputation: number;
  completedContracts: number;
  rank: number;
  seasonKey: string;
  updatedAtMs: number;
}

export interface LeaderboardCursor {
  companyScore: number;
  uid: string;
}

export interface GetLeaderboardInput {
  seasonKey?: string;
  limit?: number;
  cursor?: LeaderboardCursor;
}

export type SubmitLeaderboardScoreResult =
  | {
      ok: true;
      transactionId: string;
      idempotencyKey: string;
      seasonKey: string;
      score: number;
      updated: boolean;
      reason?: 'score-not-improved';
      entry: {
        companyName: string;
        companyScore: number;
        level: number;
        reputation: number;
        completedContracts: number;
      };
      retryCount?: number;
    }
  | {
      ok: false;
      reason: LeaderboardFailureReason;
      transactionId: string;
      idempotencyKey: string;
      retryCount?: number;
    };

export type GetLeaderboardResult =
  | {
      ok: true;
      seasonKey: string;
      seasonStartMs: number;
      seasonEndMs: number;
      entries: LeaderboardPublicEntry[];
      playerEntry: LeaderboardPublicEntry | null;
      playerRank: number | null;
      hasMore: boolean;
      nextCursor: LeaderboardCursor | null;
    }
  | {
      ok: false;
      reason: LeaderboardFailureReason;
      seasonKey: string;
    };
