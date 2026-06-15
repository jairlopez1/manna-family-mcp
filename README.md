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

---

## Setup (one-time, ~5 minutes)

### What you need first

1. **Claude Desktop** installed on your Mac → [Download here](https://claude.ai/download)
2. **Your AppSheet Access Key** → Get it from:
   > AppSheet → ⚙️ Settings → Integrations → Application Access Keys → **Copy your key**
3. A working internet connection

---

### Step 1 — Download the files

Ask Jair for the link to the private GitHub repo, then click the green **Code** button → **Download ZIP**.

Unzip the folder anywhere on your computer (e.g. your Desktop or Documents).

---

### Step 2 — Install Node.js (if you haven't already)

Node.js is a small program that runs the integration. Download the **LTS** version here:

👉 **https://nodejs.org**

Run the installer and follow the prompts. You only need to do this once.

To check if it's already installed: open **Terminal** (search "Terminal" in Spotlight) and type:
```
node -v
```
If you see a version number (like `v20.x.x`), you're good.

---

### Step 3 — Run the setup script

Open **Terminal**, then drag the project folder into the Terminal window (this sets the location). Then type:

```bash
bash setup.sh
```

Press **Enter**. The script will:
- Install everything automatically
- Ask you to paste your AppSheet Access Key
- Set up Claude Desktop for you

---

### Step 4 — Restart Claude Desktop

Quit Claude Desktop completely (right-click the Dock icon → **Quit**) and reopen it.

That's it! 🎉 You should now see the Manna Family tools available in Claude.

---

## Troubleshooting

**"I don't see the Manna Family tools in Claude"**
→ Make sure you fully quit and relaunched Claude Desktop (not just closed the window).
→ Try running `bash setup.sh` again — it won't overwrite anything that's already set up correctly.

**"Authentication error" or "API key doesn't match"**
→ Your AppSheet Access Key may have expired. Go to AppSheet → Settings → Integrations → regenerate your key, then edit the file at:
```
~/Library/Application Support/Claude/claude_desktop_config.json
```
Find the `APPSHEET_ACCESS_KEY` line and paste your new key.

**"node: command not found"**
→ Node.js isn't installed. Download it from https://nodejs.org (LTS version).

**"Cannot find module"**
→ Open Terminal in the project folder and run:
```bash
npm install && npm run build
```

---

## Updating

If Jair pushes updates to the repo:
1. Download the new ZIP (or `git pull` if you're comfortable with git)
2. Open Terminal in the project folder and run:
```bash
npm install && npm run build
```
3. Restart Claude Desktop

---

## Need help?

Contact **Jair** — he set this up and can troubleshoot any issues.

---

## Security note

Your AppSheet Access Key is stored **locally on your machine only** — it's never sent anywhere except directly to AppSheet's API when Claude uses a tool. The `.env` file and the Claude Desktop config file never leave your computer.
