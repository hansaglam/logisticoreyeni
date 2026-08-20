import 'react-native-gesture-handler';
import { registerRootComponent } from 'expo';

import App from './App';
import {
  logFatalJsException,
  logUnhandledRejection,
} from './src/utils/startupErrors';

const ErrorUtils =
  require('react-native').ErrorUtils ??
  globalThis.ErrorUtils;

if (ErrorUtils && typeof ErrorUtils.getGlobalHandler === 'function') {
  const previous = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    logFatalJsException(error, Boolean(isFatal));
    if (typeof previous === 'function') {
      previous(error, isFatal);
    }
  });
}

if (typeof globalThis !== 'undefined' && typeof globalThis.addEventListener === 'function') {
  globalThis.addEventListener('unhandledrejection', (event) => {
    logUnhandledRejection(event?.reason ?? event);
  });
}

registerRootComponent(App);
