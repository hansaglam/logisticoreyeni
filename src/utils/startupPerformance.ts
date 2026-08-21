/**
 * Cold-start timing marks — always logged so internal/release traces show
 * what blocked first paint. Marks are process-lifetime; first App import is t=0.
 */

export type StartupMarkName =
  | 'APP_START'
  | 'JS_READY'
  | 'AUTH_INIT_START'
  | 'AUTH_INIT_DONE'
  | 'ASYNC_STORAGE_READ_START'
  | 'ASYNC_STORAGE_READ_DONE'
  | 'JSON_PARSE_START'
  | 'JSON_PARSE_DONE'
  | 'NORMALIZE_SAVE_START'
  | 'NORMALIZE_SAVE_DONE'
  | 'SAVE_MIGRATION_START'
  | 'SAVE_MIGRATION_DONE'
  | 'RETENTION_MIGRATION_START'
  | 'RETENTION_MIGRATION_DONE'
  | 'REWARD_RECEIPT_MIGRATION_START'
  | 'REWARD_RECEIPT_MIGRATION_DONE'
  | 'DRIVER_RECONCILE_START'
  | 'DRIVER_RECONCILE_DONE'
  | 'MAP_RECONCILE_START'
  | 'MAP_RECONCILE_DONE'
  | 'MARKETPLACE_LOCAL_RECONCILE_START'
  | 'MARKETPLACE_LOCAL_RECONCILE_DONE'
  | 'LOCAL_SAVE_LOAD_START'
  | 'LOCAL_SAVE_LOAD_DONE'
  | 'STORE_HYDRATE_START'
  | 'STORE_HYDRATE_DONE'
  | 'OFFLINE_PROGRESSION_START'
  | 'OFFLINE_PROGRESSION_DONE'
  | 'INITIAL_AUTOSAVE_START'
  | 'INITIAL_AUTOSAVE_DONE'
  | 'CLOUD_SYNC_START'
  | 'CLOUD_SYNC_DONE'
  | 'FIRESTORE_PROFILE_START'
  | 'FIRESTORE_PROFILE_DONE'
  | 'LEADERBOARD_INIT_START'
  | 'LEADERBOARD_INIT_DONE'
  | 'MARKETPLACE_INIT_START'
  | 'MARKETPLACE_INIT_DONE'
  | 'MARKETPLACE_STARTUP_RECONCILE_START'
  | 'MARKETPLACE_STARTUP_RECONCILE_DONE'
  | 'NOTIFICATIONS_INIT_START'
  | 'NOTIFICATIONS_INIT_DONE'
  | 'ADS_START'
  | 'ADS_DONE'
  | 'MAP_PRELOAD_START'
  | 'MAP_PRELOAD_DONE'
  | 'GAME_READY'
  | 'FIRST_MAIN_SCREEN_RENDER'
  | 'MARKET_SNAPSHOT_START'
  | 'MARKET_SNAPSHOT_DONE';

export type StartupPhaseHint = 'booting' | 'loading-save' | 'finishing';

const STARTUP_LABELS: Record<StartupMarkName, string> = {
  APP_START: 'app start',
  JS_READY: 'js ready',
  AUTH_INIT_START: 'auth init start',
  AUTH_INIT_DONE: 'auth restored',
  ASYNC_STORAGE_READ_START: 'async storage read start',
  ASYNC_STORAGE_READ_DONE: 'async storage read done',
  JSON_PARSE_START: 'json parse start',
  JSON_PARSE_DONE: 'json parse done',
  NORMALIZE_SAVE_START: 'normalize save start',
  NORMALIZE_SAVE_DONE: 'normalize save done',
  SAVE_MIGRATION_START: 'save migration start',
  SAVE_MIGRATION_DONE: 'save migration done',
  RETENTION_MIGRATION_START: 'retention migration start',
  RETENTION_MIGRATION_DONE: 'retention migration done',
  REWARD_RECEIPT_MIGRATION_START: 'reward receipt migration start',
  REWARD_RECEIPT_MIGRATION_DONE: 'reward receipt migration done',
  DRIVER_RECONCILE_START: 'driver reconcile start',
  DRIVER_RECONCILE_DONE: 'driver reconcile done',
  MAP_RECONCILE_START: 'map reconcile start',
  MAP_RECONCILE_DONE: 'map reconcile done',
  MARKETPLACE_LOCAL_RECONCILE_START: 'marketplace local reconcile start',
  MARKETPLACE_LOCAL_RECONCILE_DONE: 'marketplace local reconcile done',
  LOCAL_SAVE_LOAD_START: 'local save load start',
  LOCAL_SAVE_LOAD_DONE: 'local save loaded',
  STORE_HYDRATE_START: 'store hydrate start',
  STORE_HYDRATE_DONE: 'store hydrate done',
  OFFLINE_PROGRESSION_START: 'offline progression start',
  OFFLINE_PROGRESSION_DONE: 'offline progression done',
  INITIAL_AUTOSAVE_START: 'initial autosave start',
  INITIAL_AUTOSAVE_DONE: 'initial autosave done',
  CLOUD_SYNC_START: 'cloud sync start',
  CLOUD_SYNC_DONE: 'cloud sync done',
  FIRESTORE_PROFILE_START: 'firestore profile start',
  FIRESTORE_PROFILE_DONE: 'firestore profile done',
  LEADERBOARD_INIT_START: 'leaderboard init start',
  LEADERBOARD_INIT_DONE: 'leaderboard init done',
  MARKETPLACE_INIT_START: 'marketplace init start',
  MARKETPLACE_INIT_DONE: 'marketplace init done',
  MARKETPLACE_STARTUP_RECONCILE_START: 'marketplace startup reconcile start',
  MARKETPLACE_STARTUP_RECONCILE_DONE: 'marketplace startup reconcile done',
  NOTIFICATIONS_INIT_START: 'notifications init start',
  NOTIFICATIONS_INIT_DONE: 'notifications init done',
  ADS_START: 'ads start',
  ADS_DONE: 'ads done',
  MAP_PRELOAD_START: 'map preload start',
  MAP_PRELOAD_DONE: 'map preload done',
  GAME_READY: 'game ready',
  FIRST_MAIN_SCREEN_RENDER: 'first main screen render',
  MARKET_SNAPSHOT_START: 'market snapshot start',
  MARKET_SNAPSHOT_DONE: 'market snapshot done',
};

const originMs =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? Date.now() - performance.now()
    : Date.now();

function nowMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? originMs + performance.now()
    : Date.now();
}

const startedAtMs = nowMs();
const marks = new Map<StartupMarkName, number>();
let summaryLogged = false;

export function getStartupElapsedMs(): number {
  return Math.max(0, nowMs() - startedAtMs);
}

export function getStartupMarkMs(name: StartupMarkName): number | null {
  const at = marks.get(name);
  return at == null ? null : Math.max(0, at - startedAtMs);
}

export function getStartupSpanMs(start: StartupMarkName, done: StartupMarkName): number {
  const startAt = getStartupMarkMs(start);
  const doneAt = getStartupMarkMs(done);
  if (startAt == null || doneAt == null) {
    return 0;
  }
  return Math.max(0, Math.round(doneAt - startAt));
}

export function getStartupMarks(): Array<{ name: StartupMarkName; atMs: number }> {
  return [...marks.entries()].map(([name, at]) => ({
    name,
    atMs: Math.max(0, at - startedAtMs),
  }));
}

export function markStartup(name: StartupMarkName, extra?: Record<string, unknown>): void {
  if (marks.has(name)) {
    return;
  }
  const at = nowMs();
  marks.set(name, at);
  const elapsed = Math.round(at - startedAtMs);
  const payload = extra ? ` ${JSON.stringify(extra)}` : '';
  console.log(`[STARTUP] ${STARTUP_LABELS[name]} +${elapsed}ms${payload}`);
  if (name === 'FIRST_MAIN_SCREEN_RENDER') {
    logStartupSummary();
  }
}

export function markStartupSpan(
  start: StartupMarkName,
  done: StartupMarkName,
  extra?: Record<string, unknown>,
): void {
  if (!marks.has(start)) {
    markStartup(start, extra);
  }
  markStartup(done, extra);
}

export function withStartupSpan<T>(
  start: StartupMarkName,
  done: StartupMarkName,
  fn: () => T,
): T {
  markStartup(start);
  try {
    return fn();
  } finally {
    markStartup(done);
  }
}

export async function withStartupSpanAsync<T>(
  start: StartupMarkName,
  done: StartupMarkName,
  fn: () => Promise<T>,
): Promise<T> {
  markStartup(start);
  try {
    return await fn();
  } finally {
    markStartup(done);
  }
}

export function logStartupSaveAudit(audit: Record<string, unknown>): void {
  console.log(`[STARTUP_SAVE_SIZE] ${JSON.stringify(audit)}`);
}

export function logStartupSummary(): void {
  if (summaryLogged) {
    return;
  }
  summaryLogged = true;
  const summary = {
    totalToFirstRenderMs: Math.round(getStartupElapsedMs()),
    asyncStorageMs: getStartupSpanMs('ASYNC_STORAGE_READ_START', 'ASYNC_STORAGE_READ_DONE'),
    jsonParseMs: getStartupSpanMs('JSON_PARSE_START', 'JSON_PARSE_DONE'),
    normalizeMs: getStartupSpanMs('NORMALIZE_SAVE_START', 'NORMALIZE_SAVE_DONE'),
    migrationMs: getStartupSpanMs('SAVE_MIGRATION_START', 'SAVE_MIGRATION_DONE'),
    reconcileMs:
      getStartupSpanMs('RETENTION_MIGRATION_START', 'RETENTION_MIGRATION_DONE') +
      getStartupSpanMs('REWARD_RECEIPT_MIGRATION_START', 'REWARD_RECEIPT_MIGRATION_DONE') +
      getStartupSpanMs('DRIVER_RECONCILE_START', 'DRIVER_RECONCILE_DONE') +
      getStartupSpanMs('MAP_RECONCILE_START', 'MAP_RECONCILE_DONE') +
      getStartupSpanMs('MARKETPLACE_LOCAL_RECONCILE_START', 'MARKETPLACE_LOCAL_RECONCILE_DONE'),
    offlineProgressionMs: getStartupSpanMs('OFFLINE_PROGRESSION_START', 'OFFLINE_PROGRESSION_DONE'),
    hydrateMs: getStartupSpanMs('STORE_HYDRATE_START', 'STORE_HYDRATE_DONE'),
    initialPersistMs: getStartupSpanMs('INITIAL_AUTOSAVE_START', 'INITIAL_AUTOSAVE_DONE'),
    gameReadyMs: getStartupMarkMs('GAME_READY') ?? null,
  };
  console.log(`[STARTUP_SUMMARY] ${JSON.stringify(summary)}`);
}

export function withStartupTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label}-timeout`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export function startupPhaseHint(elapsedMs: number, lastMark?: StartupMarkName): string {
  if (
    lastMark === 'LOCAL_SAVE_LOAD_START' ||
    lastMark === 'STORE_HYDRATE_START' ||
    lastMark === 'ASYNC_STORAGE_READ_START' ||
    lastMark === 'JSON_PARSE_START'
  ) {
    return 'Kayıt yükleniyor...';
  }
  if (elapsedMs >= 2000) {
    return 'Son kontroller...';
  }
  return 'Şirket hazırlanıyor...';
}
