#!/bin/bash
# Run this ON the Raspberry Pi after copying the project over.
# Usage: bash setup-pi.sh

set -e

echo "=== texboard Pi setup ==="

# Install Node.js if not present
if ! command -v node &> /dev/null; then
  echo "Installing Node.js..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

echo "Node version: $(node -v)"

# Install dependencies
echo "Installing npm dependencies..."
npm install --production

# Create systemd service for the server
echo "Setting up texboard server service..."
sudo tee /etc/systemd/system/texboard.service > /dev/null <<EOF
[Unit]
Description=texboard dashboard server
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=$(pwd)
ExecStart=$(which node) server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable texboard
sudo systemctl start texboard

echo "Server running on port $(node -e "console.log(JSON.parse(require('fs').readFileSync('config.json','utf-8')).port)")"

# Set up kiosk mode autostart
echo "Setting up kiosk mode..."
mkdir -p ~/.config/autostart

KIOSK_PORT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('config.json','utf-8')).port)")

tee ~/.config/autostart/texboard-kiosk.desktop > /dev/null <<EOF
[Desktop Entry]
Type=Application
Name=texboard Kiosk
Exec=bash -c 'sleep 5 && chromium-browser --noerrdialogs --disable-infobars --kiosk --incognito http://localhost:${KIOSK_PORT}'
X-GNOME-Autostart-enabled=true
EOF

# Disable screen blanking
if ! grep -q "xserver-command=X -s 0 -dpms" /etc/lightdm/lightdm.conf 2>/dev/null; then
  echo "Disabling screen blanking..."
  sudo sed -i '/^\[Seat:\*\]/a xserver-command=X -s 0 -dpms' /etc/lightdm/lightdm.conf 2>/dev/null || true
fi

# Hide mouse cursor
if ! command -v unclutter &> /dev/null; then
  echo "Installing unclutter (hides mouse cursor)..."
  sudo apt-get install -y unclutter
fi

tee ~/.config/autostart/unclutter.desktop > /dev/null <<EOF
[Desktop Entry]
Type=Application
Name=Unclutter
Exec=unclutter -idle 0.5 -root
X-GNOME-Autostart-enabled=true
EOF

# Rotate screen for vertical orientation
echo ""
echo "=== Screen rotation ==="
echo "If your monitor is vertical, add this to /boot/config.txt:"
echo "  display_rotate=1   (90° clockwise)"
echo "  display_rotate=3   (90° counter-clockwise)"
echo ""
echo "=== Setup complete! ==="
echo "Reboot to start in kiosk mode: sudo reboot"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status texboard    # check server status"
echo "  sudo systemctl restart texboard   # restart server"
echo "  sudo journalctl -u texboard -f    # view server logs"
