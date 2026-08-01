/**
 * Expo config plugin — Google Sign-In (AppCheckCore) için
 * GoogleUtilities / RecaptchaInterop modular headers ekler.
 * `expo prebuild` Podfile'ı yeniden yazsa bile bu satırlar korunur.
 */
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = '# Google Sign-In (AppCheckCore) modular headers';
const SNIPPET = `
  ${MARKER}
  pod 'GoogleUtilities', :modular_headers => true
  pod 'RecaptchaInterop', :modular_headers => true
`;

function withGoogleSignInModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfilePath, 'utf8');

      if (contents.includes(MARKER)) {
        return cfg;
      }

      if (contents.includes("pod 'GoogleUtilities', :modular_headers => true")) {
        return cfg;
      }

      const anchor = 'use_react_native!(';
      if (!contents.includes(anchor)) {
        throw new Error(
          'withGoogleSignInModularHeaders: could not find use_react_native!( in Podfile',
        );
      }

      contents = contents.replace(anchor, `${SNIPPET}\n  ${anchor}`);
      fs.writeFileSync(podfilePath, contents);
      return cfg;
    },
  ]);
}

module.exports = withGoogleSignInModularHeaders;
