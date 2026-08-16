/**
 * Cold-start timing marks — always logged so internal/release traces show
 * what blocked first paint. Marks are process-lifetime; first App import is t=0.
 */

export type StartupMarkName =
  | 'APP_START'
  | 'JS_READY'
  | 'AUTH_INIT_START'
  | 'AUTH_INIT_DONE'
  | 'LOCAL_SAVE_LOAD_START'
  | 'LOCAL_SAVE_LOAD_DONE'
  | 'STORE_HYDRATE_START'
  | 'STORE_HYDRATE_DONE'
  | 'CLOUD_SYNC_START'
  | 'CLOUD_SYNC_DONE'
  | 'FIRESTORE_PROFILE_START'
  | 'FIRESTORE_PROFILE_DONE'
  | 'LEADERBOARD_INIT_START'
  | 'LEADERBOARD_INIT_DONE'
  | 'MARKETPLACE_INIT_START'
  | 'MARKETPLACE_INIT_DONE'
  | 'NOTIFICATIONS_INIT_START'
  | 'NOTIFICATIONS_INIT_DONE'
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
  LOCAL_SAVE_LOAD_START: 'local save load start',
  LOCAL_SAVE_LOAD_DONE: 'local save loaded',
  STORE_HYDRATE_START: 'store hydrate start',
  STORE_HYDRATE_DONE: 'store hydrate done',
  CLOUD_SYNC_START: 'cloud sync start',
  CLOUD_SYNC_DONE: 'cloud sync done',
  FIRESTORE_PROFILE_START: 'firestore profile start',
  FIRESTORE_PROFILE_DONE: 'firestore profile done',
  LEADERBOARD_INIT_START: 'leaderboard init start',
  LEADERBOARD_INIT_DONE: 'leaderboard init done',
  MARKETPLACE_INIT_START: 'marketplace init start',
  MARKETPLACE_INIT_DONE: 'marketplace init done',
  NOTIFICATIONS_INIT_START: 'notifications init start',
  NOTIFICATIONS_INIT_DONE: 'notifications init done',
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
let gameReadySummaryLogged = false;

export function getStartupElapsedMs(): number {
  return Math.max(0, nowMs() - startedAtMs);
}

export function getStartupMarkMs(name: StartupMarkName): number | null {
  const at = marks.get(name);
  return at == null ? null : Math.max(0, at - startedAtMs);
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
  if (name === 'GAME_READY' && !gameReadySummaryLogged) {
    gameReadySummaryLogged = true;
    const summary = getStartupMarks()
      .map((mark) => `${mark.name}=${Math.round(mark.atMs)}`)
      .join(' ');
    console.log(`[STARTUP] summary ${summary}`);
  }
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
  if (lastMark === 'LOCAL_SAVE_LOAD_START' || lastMark === 'STORE_HYDRATE_START') {
    return 'Kayıt yükleniyor...';
  }
  if (elapsedMs >= 2000) {
    return 'Son kontroller...';
  }
  return 'Şirket hazırlanıyor...';
}
