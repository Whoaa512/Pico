#!/usr/bin/env bash
#
# Pi Server installer
# Usage: curl -fsSL https://raw.githubusercontent.com/anthaathi/pi-companion/main/install.sh | bash
#

set -euo pipefail

REPO="anthaathi/pi-companion"
INSTALL_DIR="$HOME/.pi/ui"
BINARY_NAME="pi-server"

info()  { printf "\033[1;34m==>\033[0m %s\n" "$*"; }
warn()  { printf "\033[1;33mwarn:\033[0m %s\n" "$*"; }
error() { printf "\033[1;31merror:\033[0m %s\n" "$*" >&2; exit 1; }

detect_platform() {
  local os arch

  os="$(uname -s)"
  arch="$(uname -m)"

  case "$os" in
    Linux)  os="linux" ;;
    Darwin) os="macos" ;;
    *)      error "Unsupported OS: $os. Please download manually from https://github.com/$REPO/releases" ;;
  esac

  case "$arch" in
    x86_64|amd64)   arch="x86_64" ;;
    aarch64|arm64)   arch="aarch64" ;;
    *)               error "Unsupported architecture: $arch. Please download manually from https://github.com/$REPO/releases" ;;
  esac

  echo "${os}-${arch}"
}

get_latest_release_tag() {
  local tag
  tag="$(curl -fsSL -H "Accept: application/vnd.github.v3+json" \
    "https://api.github.com/repos/$REPO/releases/latest" \
    | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')"

  if [ -z "$tag" ]; then
    error "Could not determine the latest release. Check https://github.com/$REPO/releases"
  fi

  echo "$tag"
}

ask_yes_no() {
  local prompt="$1" default="${2:-n}"
  local yn
  if [ "$default" = "y" ]; then
    prompt="$prompt [Y/n] "
  else
    prompt="$prompt [y/N] "
  fi

  printf "\033[1;34m==>\033[0m %s" "$prompt"
  read -r yn </dev/tty || yn=""
  yn="${yn:-$default}"

  case "$yn" in
    [Yy]*) return 0 ;;
    *)     return 1 ;;
  esac
}

# ---------------------------------------------------------------------------
# systemd service (Linux)
# ---------------------------------------------------------------------------

SYSTEMD_UNIT="$HOME/.config/systemd/user/pi-server.service"

install_systemd_service() {
  local binary="$INSTALL_DIR/$BINARY_NAME"

  mkdir -p "$(dirname "$SYSTEMD_UNIT")"
  cat > "$SYSTEMD_UNIT" <<EOF
[Unit]
Description=Pi Server – companion server for pi-coding-agent
After=network.target

[Service]
Type=simple
ExecStart=$binary
WorkingDirectory=$INSTALL_DIR
Restart=on-failure
RestartSec=5
Environment=HOME=$HOME

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable pi-server.service
  systemctl --user start pi-server.service

  info "systemd user service installed and started."
  info "  Status : systemctl --user status pi-server"
  info "  Logs   : journalctl --user -u pi-server -f"
  info "  Stop   : systemctl --user stop pi-server"
  info "  Disable: systemctl --user disable pi-server"
}

uninstall_systemd_service() {
  if [ -f "$SYSTEMD_UNIT" ]; then
    systemctl --user stop pi-server.service 2>/dev/null || true
    systemctl --user disable pi-server.service 2>/dev/null || true
    rm -f "$SYSTEMD_UNIT"
    systemctl --user daemon-reload
    info "systemd service removed."
  fi
}

# ---------------------------------------------------------------------------
# launchd service (macOS)
# ---------------------------------------------------------------------------

LAUNCHD_PLIST="$HOME/Library/LaunchAgents/co.anthaathi.pi-server.plist"

install_launchd_service() {
  local binary="$INSTALL_DIR/$BINARY_NAME"

  mkdir -p "$(dirname "$LAUNCHD_PLIST")"
  cat > "$LAUNCHD_PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>co.anthaathi.pi-server</string>
  <key>ProgramArguments</key>
  <array>
    <string>$binary</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$INSTALL_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>StandardOutPath</key>
  <string>$INSTALL_DIR/pi-server.log</string>
  <key>StandardErrorPath</key>
  <string>$INSTALL_DIR/pi-server.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>$HOME</string>
  </dict>
</dict>
</plist>
EOF

  launchctl bootout "gui/$(id -u)" "$LAUNCHD_PLIST" 2>/dev/null || true
  launchctl bootstrap "gui/$(id -u)" "$LAUNCHD_PLIST"

  info "launchd service installed and started."
  info "  Status : launchctl print gui/$(id -u)/co.anthaathi.pi-server"
  info "  Logs   : tail -f $INSTALL_DIR/pi-server.log"
  info "  Stop   : launchctl bootout gui/$(id -u) $LAUNCHD_PLIST"
  info "  Restart: launchctl kickstart -k gui/$(id -u)/co.anthaathi.pi-server"
}

uninstall_launchd_service() {
  if [ -f "$LAUNCHD_PLIST" ]; then
    launchctl bootout "gui/$(id -u)" "$LAUNCHD_PLIST" 2>/dev/null || true
    rm -f "$LAUNCHD_PLIST"
    info "launchd service removed."
  fi
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

main() {
  info "Detecting platform..."
  local platform
  platform="$(detect_platform)"
  local os="${platform%%-*}"
  info "Platform: $platform"

  info "Fetching latest release..."
  local tag
  tag="$(get_latest_release_tag)"
  info "Latest release: $tag"

  local artifact="pi-server-${platform}"
  local url="https://github.com/$REPO/releases/download/${tag}/${artifact}"

  info "Downloading $artifact..."
  mkdir -p "$INSTALL_DIR"
  local dest="$INSTALL_DIR/$BINARY_NAME"

  if ! curl -fSL --progress-bar -o "$dest" "$url"; then
    error "Download failed. Check that a release exists for your platform at:\n  $url"
  fi

  chmod +x "$dest"
  info "Installed $BINARY_NAME to $dest"

  # Initialize config if not already present
  if [ ! -f "$INSTALL_DIR/config.toml" ]; then
    info "Running 'pi-server init' to set up credentials..."
    (cd "$INSTALL_DIR" && ./"$BINARY_NAME" init </dev/tty)
  fi

  # Offer to install as a service
  echo ""
  if ask_yes_no "Would you like to install pi-server as a background service?" "y"; then
    echo ""
    if [ "$os" = "linux" ]; then
      # Check for systemd
      if command -v systemctl &>/dev/null && systemctl --user status &>/dev/null 2>&1; then
        install_systemd_service
      else
        warn "systemd user session not available. You can run pi-server manually:"
        warn "  cd $INSTALL_DIR && ./$BINARY_NAME"
      fi
    elif [ "$os" = "macos" ]; then
      install_launchd_service
    fi
  else
    echo ""
    info "Skipping service install. Run pi-server manually:"
    info "  cd $INSTALL_DIR && ./$BINARY_NAME"
  fi

  # PATH hint
  echo ""
  if ! command -v "$BINARY_NAME" &>/dev/null; then
    info "Optionally add pi-server to your PATH:"
    echo ""
    echo "  export PATH=\"$INSTALL_DIR:\$PATH\""
    echo ""
  fi

  info "Done! Run 'pi-server' to start, or scan the QR code from the Pi UI app."
}

main
