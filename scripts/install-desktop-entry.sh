#!/usr/bin/env bash
# Install the DeepSeek Harness desktop app into the user's session:
#   - copies the AppImage to ~/.local/bin
#   - installs the application icon
#   - writes a .desktop entry so it appears in your launcher / app menu
#
# Usage:  ./scripts/install-desktop-entry.sh [path-to-AppImage]
#         (defaults to the newest AppImage under ./dist)

set -euo pipefail

APP_NAME="DeepSeek Harness"
APP_ID="deepseek-harness"
DESKTOP_FILE="${APP_ID}.desktop"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="${HERE}/dist"
ICON_SRC="${HERE}/assets/icon.png"

APPDIR_BIN="${HOME}/.local/bin"
APPDIR_APPS="${HOME}/.local/share/applications"
APPDIR_ICONS="${HOME}/.local/share/icons/hicolor/512x512/apps"

# Resolve the AppImage to install.
if [[ $# -ge 1 ]]; then
  APPIMAGE="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
else
  APPIMAGE="$(ls -1t "${DIST_DIR}"/DeepSeek-Harness-*.AppImage 2>/dev/null | head -n1 || true)"
fi

if [[ -z "${APPIMAGE}" || ! -f "${APPIMAGE}" ]]; then
  echo "error: no AppImage found. Build it first with: npm run dist:appimage" >&2
  echo "       (or pass an explicit AppImage path as the first argument)" >&2
  exit 1
fi

mkdir -p "${APPDIR_BIN}" "${APPDIR_APPS}" "${APPDIR_ICONS}"

echo "==> Installing AppImage to ${APPDIR_BIN}/${APP_ID}.AppImage"
cp -f "${APPIMAGE}" "${APPDIR_BIN}/${APP_ID}.AppImage"
chmod +x "${APPDIR_BIN}/${APP_ID}.AppImage"

echo "==> Installing icon to ${APPDIR_ICONS}/${APP_ID}.png"
if [[ -f "${ICON_SRC}" ]]; then
  cp -f "${ICON_SRC}" "${APPDIR_ICONS}/${APP_ID}.png"
fi

echo "==> Writing desktop entry ${APPDIR_APPS}/${DESKTOP_FILE}"
cat > "${APPDIR_APPS}/${DESKTOP_FILE}" <<EOF
[Desktop Entry]
Type=Application
Name=${APP_NAME}
Comment=Self-contained DeepSeek Harness desktop
Exec=${APPDIR_BIN}/${APP_ID}.AppImage %U
Icon=${APP_ID}
Terminal=false
Categories=Development;Utility;
StartupWMClass=${APP_ID}
EOF

echo "==> Refreshing desktop database"
update-desktop-database "${APPDIR_APPS}" 2>/dev/null || true

echo ""
echo "Done. '${APP_NAME}' should now appear in your application launcher."
echo "You can also run it directly: ${APPDIR_BIN}/${APP_ID}.AppImage"
