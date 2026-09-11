#!/usr/bin/env bash
# Sourced by Xcode "Bundle React Native code and images".
#
# Upstream authority: LogistiCore Release build setting LOGISTICORE_BUILD_PROFILE=production
# (mirrored onto Pods/EXConstants via Podfile post_install). This script is defense in depth
# for Metro embed only — it cannot change the environment of earlier phases such as
# [Expo] Configure project or the EXConstants get-app-config script.
#
# Debug: leave profile alone (Xcode Debug sets internal).
# Release/Archive: export production + run assert gate.
#
# Keep this script free of `set -euo` when sourced so it does not alter the
# parent Bundle RN shell options.

CONFIGURATION="${CONFIGURATION:-}"
PROJECT_ROOT="${PROJECT_ROOT:-}"

if [[ -z "$PROJECT_ROOT" ]]; then
  echo "[logisticore-ios-bundle] PROJECT_ROOT is unset" >&2
  return 1 2>/dev/null || exit 1
fi

if [[ "$CONFIGURATION" == *Debug* ]]; then
  echo "[logisticore-ios-bundle] CONFIGURATION=${CONFIGURATION} — leaving profile as Xcode Debug set it (DEV/internal test ads OK)"
  return 0 2>/dev/null || exit 0
fi

export LOGISTICORE_BUILD_PROFILE=production
echo "[logisticore-ios-bundle] CONFIGURATION=${CONFIGURATION} — forcing LOGISTICORE_BUILD_PROFILE=production"

NODE_BIN="${NODE_BINARY:-}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node)"
fi

if ! "$NODE_BIN" --import tsx "$PROJECT_ROOT/scripts/assert-ios-release-ad-env.ts"; then
  echo "[logisticore-ios-bundle] production ads assert failed — aborting Release/Archive embed" >&2
  return 1 2>/dev/null || exit 1
fi
