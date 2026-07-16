const { getDefaultConfig } = require('expo/metro-config');

/**
 * Expo SDK 53+/54 + Firebase JS Auth:
 * Metro package.json "exports" resolution causes dual Auth loading →
 * "Component auth has not been registered yet".
 *
 * Docs: https://docs.expo.dev/guides/using-firebase/#configure-metro
 */
/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname);

config.resolver.sourceExts.push('cjs');
config.resolver.unstable_enablePackageExports = false;

module.exports = config;
