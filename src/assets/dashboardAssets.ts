/**
 * Dashboard görsel asset registry.
 *
 * Flag'ler asset kullanılabilirliğini kontrol eder; path bozuksa bileşenler icon fallback'e döner.
 */

export const dashboardAssetFlags = {
  useCompanyEmblem: true,
  useTruckRouteArtwork: true,
  useDailySupportTicket: true,
  usePortBackground: true,
} as const;

export const dashboardAssets = {
  companyEmblem: require('../../assets/dashboard/company-emblem-gold.png'),
  dailySupportTicket: require('../../assets/dashboard/daily-support-ticket.png'),
  portBackground: require('../../assets/dashboard/dashboard-port-background.png'),
  nextActionTruckRoute: require('../../assets/dashboard/next-action-truck-route.png'),
} as const;
