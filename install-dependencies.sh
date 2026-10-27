#!/usr/bin/env bash
set -euo pipefail

echo "Installing added dependencies..."

if command -v pnpm &> /dev/null; then
    pnpm add temporal-polyfill helmet express-rate-limit
    pnpm remove @prisma/client
elif command -v npm &> /dev/null; then
    npm install temporal-polyfill helmet express-rate-limit
    npm uninstall @prisma/client
elif command -v yarn &> /dev/null; then
    yarn add temporal-polyfill helmet express-rate-limit
    yarn remove @prisma/client
else
    echo "Error: No package manager (pnpm, npm, yarn) found in PATH." >&2
    exit 1
fi

echo "Dependencies successfully updated."
