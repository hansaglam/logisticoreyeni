import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';

if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('unhandledrejection', (event) => {
    console.error('[LogistiCore] Unhandled promise rejection:', event?.reason ?? event);
  });
}

registerRootComponent(App);
