#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Manna Family MCP — Setup Script
# Run this once to install and configure everything.
# ─────────────────────────────────────────────────────────────────────────────

set -e

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
RED="\033[0;31m"
RESET="\033[0m"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║   Manna Family MCP — Setup                  ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════╝${RESET}"
echo ""

# ── 1. Check for Node.js ─────────────────────────────────────────────────────
echo -e "${BOLD}[1/5] Checking for Node.js...${RESET}"
if ! command -v node &> /dev/null; then
  echo -e "${RED}✗ Node.js is not installed.${RESET}"
  echo ""
  echo "  Please install it from: https://nodejs.org  (download the LTS version)"
  echo "  Then run this script again."
  echo ""
  exit 1
fi

NODE_VERSION=$(node -v)
echo -e "${GREEN}✓ Node.js found: ${NODE_VERSION}${RESET}"

# ── 2. Install dependencies ───────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/5] Installing dependencies...${RESET}"
npm install --silent
echo -e "${GREEN}✓ Dependencies installed${RESET}"

# ── 3. Build the server ───────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/5] Building the server...${RESET}"
npm run build --silent
echo -e "${GREEN}✓ Build complete${RESET}"

# ── 4. Create .env with the AppSheet key ─────────────────────────────────────
echo ""
echo -e "${BOLD}[4/5] AppSheet Access Key${RESET}"
echo ""

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/.env" ]; then
  echo -e "${YELLOW}  ⚠ A .env file already exists — skipping key prompt.${RESET}"
  echo "    To change your key, edit the file: $SCRIPT_DIR/.env"
else
  echo "  You need an AppSheet Access Key to connect to the Manna Family app."
  echo "  Get it from: AppSheet → Settings → Integrations → Application Access Keys"
  echo ""
  read -rp "  Paste your AppSheet Access Key here: " USER_KEY

  if [ -z "$USER_KEY" ]; then
    echo -e "${RED}  ✗ No key entered. You can add it manually to the .env file later.${RESET}"
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
  else
    cat > "$SCRIPT_DIR/.env" << EOF
APPSHEET_APP_ID=d39f2089-f7d8-4177-a068-321b1174a305
APPSHEET_ACCESS_KEY=${USER_KEY}
EOF
    echo -e "${GREEN}  ✓ .env file created${RESET}"
  fi
fi

# ── 5. Write Claude Desktop config ───────────────────────────────────────────
echo ""
echo -e "${BOLD}[5/5] Configuring Claude Desktop...${RESET}"

CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_CONFIG="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
SERVER_PATH="$SCRIPT_DIR/dist/index.js"

# Read the access key from .env
ACCESS_KEY=$(grep "^APPSHEET_ACCESS_KEY=" "$SCRIPT_DIR/.env" | cut -d'=' -f2-)
APP_ID="d39f2089-f7d8-4177-a068-321b1174a305"

mkdir -p "$CLAUDE_CONFIG_DIR"

MCP_BLOCK=$(cat << EOF
    "manna-family": {
      "command": "node",
      "args": ["$SERVER_PATH"],
      "env": {
        "APPSHEET_APP_ID": "$APP_ID",
        "APPSHEET_ACCESS_KEY": "$ACCESS_KEY"
      }
    }
EOF
)

if [ ! -f "$CLAUDE_CONFIG" ]; then
  # No config file yet — create one from scratch
  cat > "$CLAUDE_CONFIG" << EOF
{
  "mcpServers": {
$MCP_BLOCK
  }
}
EOF
  echo -e "${GREEN}  ✓ Claude Desktop config created${RESET}"

elif grep -q '"manna-family"' "$CLAUDE_CONFIG"; then
  echo -e "${YELLOW}  ⚠ manna-family is already in your Claude Desktop config.${RESET}"
  echo "    If you changed your key, update it manually in:"
  echo "    $CLAUDE_CONFIG"

else
  # Config exists but no manna-family entry — inject it
  # We use Python for safe JSON manipulation (available on all macOS)
  python3 - "$CLAUDE_CONFIG" "$SERVER_PATH" "$APP_ID" "$ACCESS_KEY" << 'PYEOF'
import sys, json

config_path, server_path, app_id, access_key = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]

with open(config_path, "r") as f:
    config = json.load(f)

if "mcpServers" not in config:
    config["mcpServers"] = {}

config["mcpServers"]["manna-family"] = {
    "command": "node",
    "args": [server_path],
    "env": {
        "APPSHEET_APP_ID": app_id,
        "APPSHEET_ACCESS_KEY": access_key
    }
}

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PYEOF
  echo -e "${GREEN}  ✓ manna-family added to your Claude Desktop config${RESET}"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}${GREEN}╔══════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${GREEN}║   ✅  Setup complete!                        ║${RESET}"
echo -e "${BOLD}${GREEN}╚══════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${BOLD}Next step:${RESET} Quit and reopen Claude Desktop."
echo "  The Manna Family tools will be available in your next conversation."
echo ""
echo "  If you run into issues, see the README or contact Jair."
echo ""
