import type { TransportNetworkLod } from './transportNetwork';

export function networkLodForRelativeZoom(relZoom: number, previous: TransportNetworkLod): TransportNetworkLod {
  if (previous === 'NETWORK_LOW') {
    if (relZoom >= 1.32) return 'NETWORK_MEDIUM';
    return 'NETWORK_LOW';
  }
  if (previous === 'NETWORK_MEDIUM') {
    if (relZoom < 1.18) return 'NETWORK_LOW';
    if (relZoom >= 1.62) return 'NETWORK_HIGH';
    return 'NETWORK_MEDIUM';
  }
  if (relZoom < 1.48) return 'NETWORK_MEDIUM';
  return 'NETWORK_HIGH';
}
