#!/usr/bin/env bash
set -euo pipefail

systemctl --user stop m3u-player.service || true
systemctl --user disable m3u-player.service || true

rm -f "$HOME/.config/systemd/user/m3u-player.service"
rm -f "$HOME/.local/share/applications/m3u-player.desktop"

systemctl --user daemon-reload

echo "Uninstalled."
