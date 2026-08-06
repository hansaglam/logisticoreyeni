/**
 * Username profile change notifications (cross-screen refresh).
 */

type UsernameProfileListener = () => void;

const listeners = new Set<UsernameProfileListener>();

export function subscribeUsernameProfileChanged(listener: UsernameProfileListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyUsernameProfileChanged(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Listener errors must not break emitters.
    }
  }
}
