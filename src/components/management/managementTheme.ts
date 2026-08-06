import type { ManagementTone } from './managementTypes';

export interface ManagementToneStyle {
  iconColor: string;
  iconBackground: string;
  borderAccent: string;
  statusColor: string;
}

export const MANAGEMENT_TONE_STYLES: Record<ManagementTone, ManagementToneStyle> = {
  cyan: {
    iconColor: '#38BDF8',
    iconBackground: 'rgba(56, 189, 248, 0.14)',
    borderAccent: 'rgba(56, 189, 248, 0.32)',
    statusColor: 'rgba(147, 197, 253, 0.92)',
  },
  blue: {
    iconColor: '#3B82F6',
    iconBackground: 'rgba(59, 130, 246, 0.14)',
    borderAccent: 'rgba(59, 130, 246, 0.32)',
    statusColor: 'rgba(147, 197, 253, 0.9)',
  },
  amber: {
    iconColor: '#F59E0B',
    iconBackground: 'rgba(245, 158, 11, 0.14)',
    borderAccent: 'rgba(245, 158, 11, 0.32)',
    statusColor: 'rgba(252, 211, 77, 0.92)',
  },
  green: {
    iconColor: '#34D399',
    iconBackground: 'rgba(52, 211, 153, 0.14)',
    borderAccent: 'rgba(52, 211, 153, 0.32)',
    statusColor: 'rgba(110, 231, 183, 0.92)',
  },
  purple: {
    iconColor: '#A78BFA',
    iconBackground: 'rgba(167, 139, 250, 0.14)',
    borderAccent: 'rgba(167, 139, 250, 0.32)',
    statusColor: 'rgba(196, 181, 253, 0.92)',
  },
  orange: {
    iconColor: '#FB923C',
    iconBackground: 'rgba(251, 146, 60, 0.14)',
    borderAccent: 'rgba(251, 146, 60, 0.32)',
    statusColor: 'rgba(253, 186, 116, 0.95)',
  },
  gold: {
    iconColor: '#EAB308',
    iconBackground: 'rgba(234, 179, 8, 0.14)',
    borderAccent: 'rgba(234, 179, 8, 0.32)',
    statusColor: 'rgba(253, 224, 71, 0.92)',
  },
  slate: {
    iconColor: '#94A3B8',
    iconBackground: 'rgba(148, 163, 184, 0.12)',
    borderAccent: 'rgba(148, 163, 184, 0.28)',
    statusColor: 'rgba(203, 213, 225, 0.88)',
  },
};

export const MANAGEMENT_PANEL_PADDING = 22;
export const MANAGEMENT_GRID_GAP = 12;
export const MANAGEMENT_TILE_MIN_HEIGHT = 128;
export const MANAGEMENT_PANEL_MAX_HEIGHT_RATIO = 0.76;
export const MANAGEMENT_HEADER_GAP = 20;
