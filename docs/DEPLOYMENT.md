# Deploying CrewForge

CrewForge is designed for **self-hosted, single-user** deployment. This guide covers production setup on a Linux server, including persistence, reverse proxy, and environment configuration.

---

## System requirements

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 1 vCPU | 2 vCPU |
| RAM | 512 MB | 2 GB (4 GB if using knowledge graph) |
| Disk | 1 GB | 10 GB (fastembed model ~130 MB; grows with KBs) |
| Python | 3.10+ | 3.12 |
| OS | Linux / macOS | Ubuntu 22.04 LTS |

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CREWFORGE_DB` | `./crewforge.db` | Path to the SQLite database file |
| `CREWFORGE_SECRET_KEY` | *(auto-generated)* | Fernet key for secret encryption. Set this explicitly in production so secrets survive restarts. 32-byte base64-urlsafe value. |
| `PORT` | `8765` | Port to listen on (the `crewforge` CLI reads this) |

### Generating a stable secret key

```bash
python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Store this in your environment (`.env` file, systemd `EnvironmentFile`, Docker secret, etc.). If you lose it, encrypted API keys in the database become unreadable.

---

## Systemd service (recommended)

```ini
# /etc/systemd/system/crewforge.service
[Unit]
Description=CrewForge
After=network.target

[Service]
Type=simple
User=crewforge
WorkingDirectory=/opt/crewforge
Environment=CREWFORGE_DB=/var/lib/crewforge/crewforge.db
Environment=CREWFORGE_SECRET_KEY=<your-generated-key>
ExecStart=/opt/crewforge/.venv/bin/uvicorn server.app:app --host 127.0.0.1 --port 8765
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now crewforge
```

---

## Reverse proxy (nginx)

CrewForge serves both the API and the SPA on one port. Proxy everything through nginx with WebSocket + SSE support:

```nginx
server {
    listen 443 ssl;
    server_name crewforge.example.com;

    ssl_certificate     /etc/letsencrypt/live/crewforge.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crewforge.example.com/privkey.pem;

    # SSE streams need long timeouts and buffering disabled
    proxy_read_timeout 3600;
    proxy_buffering off;
    proxy_cache off;

    location / {
        proxy_pass http://127.0.0.1:8765;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Required for SSE (event streams)
        proxy_set_header Connection '';
        proxy_http_version 1.1;
        chunked_transfer_encoding on;
    }
}
```

> **SSE requirement**: `proxy_buffering off` is critical — without it, nginx buffers the event stream and the live timeline won't update.

---

## Docker

A minimal Dockerfile:

```dockerfile
FROM python:3.12-slim

# System deps for fastembed + kuzu
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl nodejs npm && rm -rf /var/lib/apt/lists/*

# Install uv
RUN pip install uv

WORKDIR /app
COPY . .

# Python deps
RUN uv sync --no-dev

# Build SPA
RUN npm --prefix web install && npm --prefix web run build

EXPOSE 8765

ENV CREWFORGE_DB=/data/crewforge.db
VOLUME ["/data"]

CMD ["uv", "run", "uvicorn", "server.app:app", "--host", "0.0.0.0", "--port", "8765"]
```

```bash
docker build -t crewforge .
docker run -d \
  -p 8765:8765 \
  -v crewforge-data:/data \
  -e CREWFORGE_SECRET_KEY=<your-key> \
  --name crewforge \
  crewforge
```

---

## Persistence

Three things to back up:

| Path | Contents |
|------|----------|
| `crewforge.db` (or `$CREWFORGE_DB`) | All workspaces, runs, knowledge bases, settings |
| `secret.key` (next to the DB, unless `$CREWFORGE_SECRET_KEY` is set) | Encryption key; losing this means losing all stored API keys |
| `knowledge_graphs/` (next to the DB) | Kuzu graph files per knowledge base |

A simple backup:

```bash
# Stop the service, copy, restart
systemctl stop crewforge
cp -a /var/lib/crewforge/ /backup/crewforge-$(date +%Y%m%d)/
systemctl start crewforge
```

SQLite also supports live backups with the `.backup` command if you can't stop the service.

---

## Security hardening

1. **Bind to loopback only** (`--host 127.0.0.1`) and put nginx in front.
2. **Set `CREWFORGE_SECRET_KEY`** explicitly — don't rely on the auto-generated file.
3. **Keep `crewforge.db` and `secret.key` out of version control** (both are gitignored by default).
4. **Webhook tokens are capability URLs** — anyone with the URL can trigger runs. Rotate from the Builder Triggers card if exposed.
5. **Tools execute with the server's privileges** — only attach tools you trust.
6. **No multi-user auth today** — if exposing to a team, put it behind an SSO proxy (Authelia, Authentik, Cloudflare Access, etc.).

---

## Upgrading

```bash
git pull origin main
uv sync
npm --prefix web install && npm --prefix web run build
systemctl restart crewforge
```

The database schema uses `CREATE TABLE IF NOT EXISTS` and adds columns via `ALTER TABLE IF NOT EXISTS` — upgrades are safe to apply on a running database after restart.

---

## Troubleshooting

**fastembed model download**: the first knowledge base ingest downloads `bge-small-en-v1.5` (~130 MB) to `~/.cache/fastembed/`. This is a one-time download; subsequent starts use the cache. If the server is air-gapped, pre-populate the cache directory.

**Kuzu lock errors**: Kuzu locks a database per process. Don't run two CrewForge instances pointing at the same `knowledge_graphs/` directory.

**SSE not streaming**: check that `proxy_buffering off` is set in nginx. Also verify the client hasn't set a proxy that buffers responses.

**MCP stdio servers hanging**: cold start of `npx`/`uvx`-based MCP servers can be slow in sandboxed environments. Remote URL servers (SSE/HTTP) are more reliable.

**Schedule not firing**: the in-process scheduler only runs while the server is up. Missed windows are not replayed. Check `systemctl status crewforge` if runs aren't firing.
