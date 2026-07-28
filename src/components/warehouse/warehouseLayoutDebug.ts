/** Geçici layout ölçümü — varsayılan kapalı. */
export const WAREHOUSE_LAYOUT_DEBUG = false;

export function logWarehouseLayout(payload: Record<string, number | string>) {
  if (!__DEV__ || !WAREHOUSE_LAYOUT_DEBUG) return;
  // eslint-disable-next-line no-console
  console.log('[warehouse-layout]', payload);
}
