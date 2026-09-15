# Hermes Console

A web app (installable on iPhone/Android) for your self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent):

- **Chat** with any bot, with live tool progress, file attachments and per-chat model choice
- **Bots** — create/edit/delete Hermes profiles: model & provider, personality (SOUL.md), API keys, working folder
- **Tasks** — Kanban board (`hermes kanban`): assign work to bots, comment, complete, block
- **Schedules** — recurring/one-off jobs via the Hermes Jobs API
- **Files** — browse, preview, download and upload everything your bots create
- **Commands** — server health, one-click maintenance and all setup commands
- Light / dark mode, shadcn/ui design, username + password login

```
Phone / browser ──HTTPS──▶ Hermes Console (server/hermes_console.py, port 8787)
                              ├─ serves the prebuilt app (web/dist)
                              ├─ /api/console/hermes/<bot>/… ─▶ Hermes API server (127.0.0.1:8642, /p/<bot>/…)
                              ├─ bots & tasks ─▶ `hermes profile …`, `hermes kanban …`
                              └─ files ─▶ ~/hermes-workspace, ~/.hermes/cache, cron outputs
```

The console runs on the same machine as Hermes. It is a single Python file using only the standard library, and the web app is prebuilt — **nothing is compiled on the server**.

## Install

On the server where Hermes runs:

```bash
# 1. Enable the Hermes API server and multi-bot routing
grep -q '^API_SERVER_KEY=' ~/.hermes/.env || echo "API_SERVER_KEY=$(openssl rand -hex 32)" >> ~/.hermes/.env
grep -q '^API_SERVER_ENABLED=' ~/.hermes/.env || echo "API_SERVER_ENABLED=true" >> ~/.hermes/.env
hermes config set gateway.multiplex_profiles true
hermes gateway restart

# 2. Unpack the console (copy dist/hermes-console.tar.gz to the server first)
mkdir -p ~/hermes-console && tar -xzf ~/hermes-console.tar.gz -C ~/hermes-console
cd ~/hermes-console
python3 server/hermes_console.py init        # choose username & password
bash deploy/install-service.sh               # run as a systemd service
```

Open `http://SERVER_IP:8787`, or better, put it behind HTTPS (required to install it on a phone):

```bash
sudo apt install -y caddy
echo 'console.example.com {
  reverse_proxy 127.0.0.1:8787
}' | sudo tee /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Then set `CONSOLE_HOST=127.0.0.1` in `server/console.env` and `sudo systemctl restart hermes-console`.

**Install on phone:** Safari → Share → *Add to Home Screen* (iOS) · Chrome → ⋮ → *Install app* (Android).

## Configuration

`server/console.env` (see `console.env.example`): login, port, `HERMES_API_URL`, `HERMES_HOME`, `CONSOLE_WORKSPACE` (bots' shared file folder) and `FILES_ROOTS` (extra folders shown in Files). Only files inside these roots can be read or changed through the console.

## Develop

```bash
cd web && npm install
CONSOLE_DEV_TARGET=http://SERVER:8787 npm run dev     # proxies /api to a running console
bash scripts/package.sh                               # builds dist/hermes-console.tar.gz
```
