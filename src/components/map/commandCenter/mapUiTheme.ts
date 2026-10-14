/**
 * Landscape operations command center tokens.
 * Presentation only. No geographic or gameplay values.
 */

export const mapUiTheme = {
  background: '#06101C',
  surface: 'rgba(10, 22, 38, 0.94)',
  surfaceElevated: 'rgba(14, 32, 54, 0.96)',
  surfaceGlass: 'rgba(8, 18, 32, 0.78)',
  border: 'rgba(120, 156, 196, 0.22)',
  borderStrong: 'rgba(88, 196, 232, 0.55)',
  textPrimary: '#E7F0FA',
  textSecondary: '#9AAEC4',
  textMuted: '#6E849C',
  cyanPrimary: '#3DDCFF',
  bluePrimary: '#2F8CFF',
  greenSuccess: '#3DDC97',
  amberWarning: '#E2B15A',
  redCritical: '#F07178',
  roadColor: '#7FDBFF',
  railColor: '#C5D0DC',
  seaColor: '#6E8CA8',
  airColor: '#8EA0B8',
  railWidthCompact: 56,
  railWidthRegular: 76,
  railWidthWide: 92,
  topBarHeight: 34,
  bottomKpiHeight: 36,
  inspectorWidthRegular: 232,
  inspectorWidthWide: 260,
  compactInspectorWidth: 220,
  panelRadius: 8,
  smallRadius: 4,
  space2: 2,
  space4: 4,
  space6: 6,
  space8: 8,
  space12: 12,
} as const;

export type MapLayoutBand = 'compact' | 'regular' | 'wide';

/**
 * Breakpoints use React Native logical points, not screenshot pixels.
 * iPhone Pro landscape windows are about 840–960pt, so they stay regular.
 * Only narrow windows (such as iPhone SE landscape) collapse the inspector.
 */
export function resolveMapLayoutBand(windowWidth: number): MapLayoutBand {
  if (!Number.isFinite(windowWidth) || windowWidth < 700) return 'compact';
  if (windowWidth < 1100) return 'regular';
  return 'wide';
}

/**
 * Compact starts collapsed. Opening the inspector docks it beside the map
 * so the panel cannot cover pan and pinch.
 */

export function resolveMapChrome(band: MapLayoutBand): {
  railWidth: number;
  inspectorWidth: number;
  inspectorMode: 'docked' | 'overlay';
  showRailLabels: boolean;
} {
  if (band === 'wide') {
    return {
      railWidth: mapUiTheme.railWidthWide,
      inspectorWidth: mapUiTheme.inspectorWidthWide,
      inspectorMode: 'docked',
      showRailLabels: true,
    };
  }
  if (band === 'regular') {
    return {
      railWidth: mapUiTheme.railWidthRegular,
      inspectorWidth: mapUiTheme.inspectorWidthRegular,
      inspectorMode: 'docked',
      showRailLabels: true,
    };
  }
  return {
    railWidth: mapUiTheme.railWidthCompact,
    inspectorWidth: mapUiTheme.compactInspectorWidth,
    inspectorMode: 'docked',
    showRailLabels: false,
  };
}
