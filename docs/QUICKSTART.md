# CrewForge Quick Start

This guide takes you from zero to a running multi-agent workflow in about 10 minutes.

---

## Prerequisites

- Python 3.10 or later
- [uv](https://docs.astral.sh/uv/) package manager (`pip install uv`)
- Node.js 18 or later

---

## 1. Install

```bash
git clone https://github.com/Arturski/CrewForge.git
cd CrewForge

# Install Python dependencies (uses uv.lock for exact reproducibility)
uv sync

# Build the React UI (one-time; output goes to web/dist/)
npm --prefix web install
npm --prefix web run build
```

---

## 2. Launch

```bash
uv run crewforge
# → CrewForge started at http://localhost:8765
```

The browser opens automatically. A demo workspace ("Research Team") is pre-loaded so you can explore immediately.

To use a custom database location:

```bash
CREWFORGE_DB=/path/to/my.db uv run crewforge
```

---

## 3. Your first workflow (dry-run, no key needed)

### Build it

1. Click **New workflow** on the Dashboard.
2. Name it "My first crew".
3. In the **Builder**, click **+ Agent** in the canvas palette:
   - Role: `Research Analyst`
   - Goal: `Find accurate information on the given topic`
   - Backstory: `You are a meticulous researcher with 10 years of experience`
4. Click **+ Task**:
   - Assign to the Research Analyst
   - Description: `Research the following topic thoroughly: {topic}`
   - Expected output: `A comprehensive 3-paragraph summary`
5. In the **Inputs** card, add an input named `topic` with default `quantum computing`.

### Run it

1. Make sure **Dry run** is toggled **on** (default).
2. Click **Run** — a run ID appears and the timeline starts streaming events.
3. The canvas node glows while the agent "works", then turns green on completion.
4. Click the run in the timeline to see the full output.

---

## 4. Go live with a real LLM

1. Go to **Settings → Models → Add connection**.
2. Choose a provider preset (OpenAI, Anthropic, MiniMax, Ollama, etc.) or enter a custom base URL.
3. Enter your API key → click **Test connection**.
4. Back in the Builder, toggle **Dry run** off → click **Run**.

**Supported providers**: any OpenAI-compatible endpoint. Examples:

| Provider | Base URL | Notes |
|----------|----------|-------|
| OpenAI | *(preset)* | GPT-4o, GPT-4 Turbo, etc. |
| Anthropic | *(preset)* | Claude Sonnet, Haiku, Opus |
| MiniMax | `https://api.minimaxi.chat/v1` | Model: `MiniMax-Text-01` |
| Ollama | `http://localhost:11434/v1` | Any locally pulled model |
| Groq | *(preset)* | Llama 3, Mixtral |
| Together AI | *(preset)* | Open-source models |

---

## 5. Add tools to your agents

1. In the Builder, click an agent node to open the inspector.
2. Scroll to **Tools** → click **Browse tools**.
3. Pick from 103 built-in tools (search, code interpreter, web scraping, etc.).
4. Tools that need API keys show a "needs key" badge — click **Configure** to set them.

### Connect an MCP server

1. Go to **Tools → Integrations**.
2. Search the MCP marketplace or click **Connect manually**.
3. Enter the server command (stdio) or URL (SSE/HTTP).
4. Connected tools appear in the Built-in catalog and can be attached to agents.

---

## 6. Add a knowledge base

1. Go to **Knowledge → New knowledge base**.
2. Name it (e.g., "Company docs").
3. Add sources: paste text, upload a file, enter a URL, or connect a GitHub repo.
4. Ingest runs in the background; a progress indicator shows "X/N pages".
5. *(Optional)* Click **Build graph** to extract entities and relations with your LLM.
6. Back in the Builder, attach the KB to an agent or the whole workflow.

The agent gets a `search_<kb_name>` tool automatically.

---

## 7. Run a batch

Batch mode runs your workflow over many input rows at once.

1. In the Builder, click **Batch** (shown when your workflow has inputs).
2. Paste a CSV — the header row must match your input names:
   ```
   topic
   quantum computing
   climate change
   artificial intelligence
   ```
3. Click **Run batch** → each row becomes a tracked run.
4. Go to **Runs** to see the batch progress card; click any row to drill in.

---

## 8. Write test cases

The eval suite lets you define a test set that runs automatically and scores every output.

1. In the Builder, scroll to the **Tests** card.
2. Click **+ Case** and fill in inputs + checks:
   - `contains` / `not_contains` / `regex` / `equals` — deterministic, work in dry-run
   - `judge` — LLM grades the output against a plain-language criterion (live only)
3. Click **Run tests** → the Runs page shows a pass-rate badge and per-check ✓/✗.

Test cases are saved on the workflow spec and re-run anytime for regression testing.

---

## 9. Schedule a workflow

1. In the Builder, scroll to the **Triggers** card.
2. Click **+ Schedule** → pick a preset (hourly, daily, etc.) or enter a cron expression.
3. Pin specific input values or leave blank to use the workflow defaults.
4. Toggle the schedule on; it fires while the server is running.

To trigger via webhook:

1. In the Triggers card, click **Enable webhook** → copy the URL.
2. `POST` to it with `{"inputs": {"topic": "AI news"}, "dry_run": false}`.

---

## 10. Export your workflow

Click **Code** in the sidebar to view the generated Python project, or download a zip from the Builder header. The output is a complete, runnable CrewAI project with no CrewForge dependency.

---

## Dev mode

For development with hot reload:

```bash
# Terminal 1
uv run uvicorn server.app:app --reload --port 8765

# Terminal 2
npm --prefix web run dev   # Vite dev server → http://localhost:5180
```

Quality gates:

```bash
uv run --extra dev pytest -q       # 52 tests, ~5 seconds
uv run --extra dev ruff check server tests
npm --prefix web run build         # TypeScript strict + build
```
