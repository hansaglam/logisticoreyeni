const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const GOOGLE_UTILITIES_LINE =
  "pod 'GoogleUtilities', :modular_headers => true";
const RECAPTCHA_INTEROP_LINE =
  "pod 'RecaptchaInterop', :modular_headers => true";

/**
 * AppCheckCore (Google Sign-In / Ads) needs modular headers for
 * GoogleUtilities + RecaptchaInterop when linked as static libraries.
 */
function withIosModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(cfg.modRequest.platformProjectRoot, 'Podfile');
      if (!fs.existsSync(podfilePath)) {
        return cfg;
      }

      let contents = fs.readFileSync(podfilePath, 'utf8');
      if (contents.includes(GOOGLE_UTILITIES_LINE)) {
        return cfg;
      }

      const injection = `  ${GOOGLE_UTILITIES_LINE}\n  ${RECAPTCHA_INTEROP_LINE}\n`;
      const next = contents.replace(
        /(target\s+['"][^'"]+['"]\s+do\s*\n)/,
        `$1${injection}`,
      );

      if (next === contents) {
        throw new Error(
          'withIosModularHeaders: could not find target block in Podfile',
        );
      }

      fs.writeFileSync(podfilePath, next);
      return cfg;
    },
  ]);
}

module.exports = withIosModularHeaders;
