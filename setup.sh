#!/bin/bash
# ─────────────────────────────────────────────────────────────────────────────
# Manna Family MCP — Setup Script
# Run this once to configure Claude Desktop. No build steps required.
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
echo -e "${BOLD}[1/3] Checking for Node.js...${RESET}"
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

# ── 2. Set work email ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}[2/3] Your work email${RESET}"
echo ""
echo "  This is used to automatically identify you in the Manna Family app."
echo "  Use your @wearemanna.org email address (lowercase)."
echo ""

CURRENT_EMAIL=$(git config --global user.email 2>/dev/null || echo "")
if [ -n "$CURRENT_EMAIL" ]; then
  echo -e "  Current email: ${YELLOW}${CURRENT_EMAIL}${RESET}"
  read -rp "  Press Enter to keep it, or type a new email: " NEW_EMAIL
  if [ -n "$NEW_EMAIL" ]; then
    git config --global user.email "$NEW_EMAIL"
    echo -e "${GREEN}  ✓ Email set to: $NEW_EMAIL${RESET}"
  else
    echo -e "${GREEN}  ✓ Keeping: $CURRENT_EMAIL${RESET}"
  fi
else
  read -rp "  Enter your work email: " NEW_EMAIL
  if [ -z "$NEW_EMAIL" ]; then
    echo -e "${RED}  ✗ No email entered. Run this script again with your email.${RESET}"
    exit 1
  fi
  git config --global user.email "$NEW_EMAIL"
  echo -e "${GREEN}  ✓ Email set to: $NEW_EMAIL${RESET}"
fi

# ── 3. Configure Claude Desktop ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}[3/3] Configuring Claude Desktop...${RESET}"
echo ""

echo "  You need an AppSheet Access Key to connect to the Manna Family app."
echo "  Get it from: AppSheet → ⚙️ Settings → Integrations → Application Access Keys"
echo ""
read -rp "  Paste your AppSheet Access Key here: " USER_KEY

if [ -z "$USER_KEY" ]; then
  echo -e "${RED}  ✗ No key entered. Run this script again when you have your key.${RESET}"
  exit 1
fi

CLAUDE_CONFIG_DIR="$HOME/Library/Application Support/Claude"
CLAUDE_CONFIG="$CLAUDE_CONFIG_DIR/claude_desktop_config.json"
APP_ID="d39f2089-f7d8-4177-a068-321b1174a305"

mkdir -p "$CLAUDE_CONFIG_DIR"

if [ ! -f "$CLAUDE_CONFIG" ]; then
  # No config file yet — create one from scratch
  cat > "$CLAUDE_CONFIG" << EOF
{
  "mcpServers": {
    "manna-family": {
      "command": "npx",
      "args": ["-y", "manna-family-mcp"],
      "env": {
        "APPSHEET_APP_ID": "$APP_ID",
        "APPSHEET_ACCESS_KEY": "$USER_KEY"
      }
    }
  }
}
EOF
  echo -e "${GREEN}  ✓ Claude Desktop config created${RESET}"

elif grep -q '"manna-family"' "$CLAUDE_CONFIG"; then
  # Already configured — update the key in place
  python3 - "$CLAUDE_CONFIG" "$APP_ID" "$USER_KEY" << 'PYEOF'
import sys, json

config_path, app_id, access_key = sys.argv[1], sys.argv[2], sys.argv[3]

with open(config_path, "r") as f:
    config = json.load(f)

config["mcpServers"]["manna-family"] = {
    "command": "npx",
    "args": ["-y", "manna-family-mcp"],
    "env": {
        "APPSHEET_APP_ID": app_id,
        "APPSHEET_ACCESS_KEY": access_key
    }
}

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PYEOF
  echo -e "${GREEN}  ✓ Manna Family config updated${RESET}"

else
  # Config exists but no manna-family entry — inject it
  python3 - "$CLAUDE_CONFIG" "$APP_ID" "$USER_KEY" << 'PYEOF'
import sys, json

config_path, app_id, access_key = sys.argv[1], sys.argv[2], sys.argv[3]

with open(config_path, "r") as f:
    config = json.load(f)

if "mcpServers" not in config:
    config["mcpServers"] = {}

config["mcpServers"]["manna-family"] = {
    "command": "npx",
    "args": ["-y", "manna-family-mcp"],
    "env": {
        "APPSHEET_APP_ID": app_id,
        "APPSHEET_ACCESS_KEY": access_key
    }
}

with open(config_path, "w") as f:
    json.dump(config, f, indent=2)
    f.write("\n")
PYEOF
  echo -e "${GREEN}  ✓ Manna Family added to your Claude Desktop config${RESET}"
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
echo "  Updates are automatic — no action needed when new versions are released."
echo ""
echo "  If you run into issues, see the README or contact Jair."
echo ""
