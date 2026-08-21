#!/usr/bin/env bash
set -euo pipefail
if command -v termux-wake-lock >/dev/null 2>&1; then termux-wake-lock || true; fi
export NODE_ENV="production"
exec npm run start --workspace @trip-music/tablet
