import {
  appendOsDedupeKey,
  hasOsDedupeKey,
  type OsGameplayNotificationSpec,
} from '../domain/osNotifications';
import { emitOsGameplayNotification } from '../services/notifications';

export function dispatchOsGameplayNotification(
  keys: string[] | undefined,
  commitKeys: (next: string[]) => void,
  spec: OsGameplayNotificationSpec | null,
  options?: { allowWhenForeground?: boolean },
): void {
  if (!spec) {
    return;
  }
  const current = keys ?? [];
  if (hasOsDedupeKey(current, spec.dedupeKey)) {
    return;
  }
  commitKeys(appendOsDedupeKey(current, spec.dedupeKey));
  void emitOsGameplayNotification(spec, options);
}

export function rememberOsDedupeKeys(
  keys: string[] | undefined,
  extra: string[],
): string[] {
  let next = keys ?? [];
  for (const key of extra) {
    next = appendOsDedupeKey(next, key);
  }
  return next;
}
