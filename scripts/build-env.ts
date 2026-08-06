import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export type BuildProfileName = 'internal' | 'production';

export function parseEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

export function loadBuildProfileEnv(
  root: string,
  profile: BuildProfileName,
  options?: { includeBaseEnv?: boolean },
): Record<string, string> {
  const includeBase = options?.includeBaseEnv !== false;
  const merged: Record<string, string> = {};
  if (includeBase) {
    Object.assign(merged, parseEnvFile(resolve(root, '.env')));
  }
  Object.assign(merged, parseEnvFile(resolve(root, `.env.${profile}`)));
  merged.LOGISTICORE_BUILD_PROFILE = profile;
  return merged;
}
