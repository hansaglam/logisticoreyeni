export type LabelBounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

export type CollidableLabel = {
  id: string;
  priority: number;
  selected: boolean;
  bounds: LabelBounds;
};

function overlaps(a: LabelBounds, b: LabelBounds): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/**
 * Highest priority first. A selected label is never dropped for overlap.
 * The result is deterministic for the same input order of equal priorities.
 */
export function resolveLabelVisibility<T extends CollidableLabel>(labels: readonly T[]): T[] {
  const sorted = [...labels].sort((a, b) => {
    if (a.selected !== b.selected) return a.selected ? -1 : 1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const placed: T[] = [];
  const boxes: LabelBounds[] = [];
  for (const label of sorted) {
    const blocked = boxes.some((box) => overlaps(box, label.bounds));
    if (blocked && !label.selected) continue;
    placed.push(label);
    boxes.push(label.bounds);
  }
  return placed;
}
