import type { StyleProp, ViewStyle } from 'react-native';

export type TutorialTargetLayoutMode = 'preserve' | 'stretch' | 'content' | 'flex';

/**
 * Tutorial target wrappers must not change parent layout unless explicitly requested.
 * - preserve: no width/align override (default)
 * - stretch: full-width sections/cards/lists
 * - flex: equal flex child in a row/column (flex:1, no width:100%)
 * - content: intrinsic buttons/chips/badges
 */
export function getTargetLayoutStyle(
  mode: TutorialTargetLayoutMode = 'preserve',
): ViewStyle {
  switch (mode) {
    case 'stretch':
      return {
        alignSelf: 'stretch',
        width: '100%',
        minWidth: 0,
      };
    case 'flex':
      return {
        flex: 1,
        minWidth: 0,
        alignSelf: 'stretch',
      };
    case 'content':
      return {
        alignSelf: 'flex-start',
        minWidth: 0,
      };
    case 'preserve':
    default:
      return {
        minWidth: 0,
      };
  }
}

export function mergeTargetLayoutStyles(
  mode: TutorialTargetLayoutMode | undefined,
  style: StyleProp<ViewStyle> | undefined,
): StyleProp<ViewStyle> {
  return [getTargetLayoutStyle(mode ?? 'preserve'), style];
}
