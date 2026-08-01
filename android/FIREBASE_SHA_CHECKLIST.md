# Firebase SHA fingerprints — Play Internal Testing / Google Sign-In

## Verified local keystores

### Debug (`android/app/debug.keystore`)
- SHA-1: `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`
- SHA-256: `FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C`
- Matches `google-services.json` certificate_hash for `com.ethemsincar.logisticore`

### Upload / release (`android/app/logisticore-upload.keystore`)
- SHA-1: `EE:F5:06:40:7D:80:0E:6C:41:8D:F2:F2:6C:95:84:B8:E3:03:9F:78`
- SHA-256: `19:87:D3:00:ED:C4:05:38:C7:4B:5D:50:CE:D9:5C:30:41:D6:50:C3:EE:7E:42:0D:53:36:8F:07:A9:8E:31:49`
- **Not present** in current `google-services.json` oauth_client hashes

## Manual Play Console step (required for Internal Testing Google Sign-In)

Play Internal Testing builds are re-signed with **Google Play App Signing**.
Upload key SHA alone is not enough for devices installing from Play.

1. Play Console → Setup → App integrity → App signing
2. Copy **App signing key certificate** SHA-1 and SHA-256
3. Firebase Console → Project settings → Your apps → Android `com.ethemsincar.logisticore`
4. Add fingerprints:
   - Play App signing SHA-1 / SHA-256
   - Upload key SHA-1 / SHA-256 (above)
5. Re-download `google-services.json` into project root and `android/app/`
6. Rebuild AAB

Do not confuse **Upload key** with **App signing key**.
