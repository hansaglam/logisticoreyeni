import React from 'react';

import { isBackendDiagnosticsEnabled } from '../services/backendDiagnostics';
import BackendDiagnosticsPanel from './BackendDiagnosticsPanel';

/** Diagnostics UI is internal-only; production store builds never mount the panel. */
export default function BackendDiagnosticsGate() {
  if (!isBackendDiagnosticsEnabled()) {
    return null;
  }
  return <BackendDiagnosticsPanel />;
}
