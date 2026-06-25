# Manna Family — Claude AI Integration

This tool connects **Claude Desktop** to the Manna Family app (AppSheet), so you can manage tasks, log time, request PTO, and more — all by just talking to Claude in plain English.

---

## What can it do?

Once set up, you can ask Claude things like:

- *"What tasks are assigned to me?"*
- *"Log 90 minutes on the website project"*
- *"Create a task: Update donor report, due Friday, high priority"*
- *"What's my PTO balance?"*
- *"Request 2 days of PTO from June 20–21"*
- *"Who on the team has the most open tasks?"*
- *"Show me all time logged on MBC in May"*
- *"What's overdue on my plate?"*
- *"Give me a summary of my week"*
- *"Approve PTO request PTO12345678"*

---

## Setup (one-time, ~3 minutes)

### What you need first

1. **Claude Desktop** installed on your Mac → [Download here](https://claude.ai/download)
2. **Your AppSheet Access Key** → Get it from:
   > AppSheet → ⚙️ Settings → Integrations → Application Access Keys → **Copy your key**
3. A working internet connection

---

### Step 1 — Install Node.js (if you haven't already)

Node.js is a small program that runs the integration in the background. Download the **LTS** version:

👉 **https://nodejs.org**

Run the installer and follow the prompts. You only need to do this once ever.

To check if it's already installed: open **Terminal** (search "Terminal" in Spotlight) and type:
```
node -v
```
If you see a version number (like `v20.x.x`), you're good — skip this step.

---

### Step 2 — Run the setup script

Download this repo as a ZIP (click the green **Code** button → **Download ZIP**) and unzip it anywhere.

Open **Terminal**, drag the unzipped folder into the Terminal window, then type:

```bash
bash setup.sh
```

Press **Enter**. The script will ask for your AppSheet Access Key and configure Claude Desktop automatically. That's all it does — no installing packages, no building anything.

---

### Step 3 — Restart Claude Desktop

Quit Claude Desktop completely (right-click the Dock icon → **Quit**) and reopen it.

That's it! You should now see the Manna Family tools available in Claude.

---

## Updating

**Nothing to do.** Updates are delivered automatically — the next time Claude Desktop launches after a new version is published, it picks it up on its own.

---

## Troubleshooting

**"I don't see the Manna Family tools in Claude"**
→ Make sure you fully quit and relaunched Claude Desktop (not just closed the window).
→ Run `bash setup.sh` again — it's safe to re-run and will update your config.

**"Authentication error" or "API key doesn't match"**
→ Your AppSheet Access Key may have expired. Regenerate it in AppSheet → Settings → Integrations, then run `bash setup.sh` again with your new key.

**"node: command not found"**
→ Node.js isn't installed. Download it from https://nodejs.org (LTS version).

---

## Security note

Your AppSheet Access Key is stored **locally on your machine only** in the Claude Desktop config file (`~/Library/Application Support/Claude/claude_desktop_config.json`). It is never committed to git or sent anywhere except directly to AppSheet's API when Claude uses a tool.

---

## Need help?

Contact **Jair** — he set this up and can troubleshoot any issues.
