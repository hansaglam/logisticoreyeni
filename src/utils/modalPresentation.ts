import { Platform, type ModalProps } from 'react-native';

/** iOS only allows one presented view controller unless later modals use overFullScreen. */
export const IOS_STACKED_MODAL_PROPS: Pick<ModalProps, 'presentationStyle'> =
  Platform.OS === 'ios' ? { presentationStyle: 'overFullScreen' } : {};

export function shouldEmbedNestedFuelUi(): boolean {
  return Platform.OS === 'ios';
}
