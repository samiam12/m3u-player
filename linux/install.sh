#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

mkdir -p "$HOME/.config/systemd/user"
mkdir -p "$HOME/.local/share/applications"

# Install user service
install -m 0644 "$APP_DIR/systemd/m3u-player.service" "$HOME/.config/systemd/user/m3u-player.service"

# Install desktop file
install -m 0644 "$APP_DIR/linux/m3u-player.desktop" "$HOME/.local/share/applications/m3u-player.desktop"

systemctl --user daemon-reload
systemctl --user enable --now m3u-player.service

echo "Installed. You can launch 'M3U Player' from your Applications menu."
echo "Service status: systemctl --user status m3u-player.service"
