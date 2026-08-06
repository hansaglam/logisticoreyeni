/**
 * Prevents onLayout → setState loops when layout measurements jitter by a few pixels.
 */
export function commitLayoutReady(
  setReady: (value: boolean) => void,
  alreadyReady: boolean,
): void {
  if (alreadyReady) {
    return;
  }
  setReady(true);
}

export function commitLayoutSize<T extends { width: number; height: number }>(
  setSize: (value: T | ((previous: T) => T)) => void,
  width: number,
  height: number,
  epsilon = 3,
): void {
  const nextWidth = Math.round(width);
  const nextHeight = Math.round(height);
  setSize((previous) => {
    if (
      Math.abs(previous.width - nextWidth) <= epsilon &&
      Math.abs(previous.height - nextHeight) <= epsilon
    ) {
      return previous;
    }
    return {
      ...previous,
      width: nextWidth,
      height: nextHeight,
    };
  });
}
