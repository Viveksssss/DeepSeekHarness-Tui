#!/usr/bin/env bash
# Fetch and prepare the bundled Node.js runtime used to run the dsh web server.
#
# dsh is built against Node 22 and its native modules (sharp, node-pty, …) do
# not run under Electron's embedded Node 24, so we ship a real Node 22 runtime
# inside the app (electron-builder `extraResources`).
#
# Usage:  ./scripts/fetch-node-runtime.sh [version]
#         (defaults to 22.23.2)

set -euo pipefail

NODE_VERSION="${1:-22.23.2}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENDOR="${HERE}/vendor"
DEST="${VENDOR}/node"
ARCH="x64"

# Optional mirror (set NODE_MIRROR to https://npmmirror.com/mirrors/node/ in CN).
MIRROR="${NODE_MIRROR:-https://nodejs.org/dist}"
TARBALL="node-v${NODE_VERSION}-linux-${ARCH}.tar.xz"
URL="${MIRROR}/v${NODE_VERSION}/${TARBALL}"

mkdir -p "${VENDOR}"
TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

echo "==> Downloading ${URL}"
curl -fSL --retry 3 -o "${TMP}/${TARBALL}" "${URL}"

echo "==> Extracting"
tar -xJf "${TMP}/${TARBALL}" -C "${TMP}"

echo "==> Installing runtime to ${DEST}"
rm -rf "${DEST}"
mv "${TMP}/node-v${NODE_VERSION}-linux-${ARCH}" "${DEST}"

# Keep only the self-contained `node` binary (built-ins are embedded) and the
# license. npm/corepack, headers, and docs are not needed to run dsh.
rm -rf "${DEST}/include" "${DEST}/share" "${DEST}/lib" \
       "${DEST}/CHANGELOG.md" "${DEST}/README.md"

echo "==> Done: $("${DEST}/bin/node" --version)"
