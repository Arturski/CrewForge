# Security Policy

CrewForge is self-hosted and single-user by default. Even so, agentic workflows
carry real risks. Please read this before running untrusted workflows or skills.

## Threat model & current posture

- **Skills execute code.** CrewAI tools and (soon) MCP servers run with the
  privileges of the CrewForge process. A malicious skill can read files, make
  network calls, or exfiltrate data. **Only attach skills you trust.**
- **MCP marketplace (planned).** When the open skill marketplace lands, every
  skill will carry an [`mcp-scan`](https://github.com/invariantlabs-ai/mcp-scan)
  security rating (tool-poisoning / prompt-injection / rug-pull detection) and a
  pinned content hash. Default policy is **warn-but-allow**: risky skills are
  flagged with an explicit confirmation, never silently installed. Minimize the
  number of installed skills and re-scan after changes.
- **Provider API keys are encrypted at rest** (Fernet). The symmetric key lives
  in a `0600` file next to the database (`secret.key`, gitignored) or via
  `CREWFORGE_SECRET_KEY`. Keys are decrypted only in-process at run time and are
  never returned to the client (the settings API reports only `api_key_set`).
  Keep `secret.key` and `crewforge.db` out of version control.
- **Runs are in-process today.** Containerized per-run isolation is on the
  roadmap; until then, treat a workflow run as running with your local trust.
- **Dry-run mode** uses a built-in mock LLM and makes no network calls — safe for
  exploring untrusted workflows.

## Reporting a vulnerability

Please open a [GitHub Security Advisory](https://github.com/Arturski/CrewForge/security/advisories/new)
or email the maintainer rather than filing a public issue. We aim to acknowledge
within a few days.

## Hardening roadmap

Containerized run workers · encrypted secret vault · mcp-scan gating · SSRF/path
guards on tool inputs · per-skill capability allowlists.
