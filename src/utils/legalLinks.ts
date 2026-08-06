import { Linking } from 'react-native';

export const LEGAL_LINKS = {
  privacyPolicy: 'https://hansaglam.github.io/logisticore-legal/privacy-policy/',
  privacyChoices: 'https://hansaglam.github.io/logisticore-legal/privacy-choices/',
  accountDeletion: 'https://hansaglam.github.io/logisticore-legal/account-deletion/',
  support: 'https://hansaglam.github.io/logisticore-legal/support/',
} as const;

export type LegalLinkKey = keyof typeof LEGAL_LINKS;

export async function openLegalLink(
  key: LegalLinkKey,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const url = LEGAL_LINKS[key];
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (!canOpen) {
      return { ok: false, message: 'Bağlantı bu cihazda açılamadı.' };
    }
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    return { ok: false, message: 'Bağlantı açılırken bir hata oluştu.' };
  }
}
