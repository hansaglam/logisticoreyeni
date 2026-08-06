/**
 * App-wide first-entry tutorial kill switch.
 * Set EXPO_PUBLIC_APP_TUTORIALS_ENABLED=false to disable all app tutorials.
 */
export const APP_TUTORIALS_ENABLED =
  process.env.EXPO_PUBLIC_APP_TUTORIALS_ENABLED !== 'false';
