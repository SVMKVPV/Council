# Council

**One brief. Four perspectives. One build you control.**

Council is a collaborative AI workspace for turning one request into a reviewed plan and, eventually, a build. It gives Claude, ChatGPT, Gemini, and a configurable Meta/Llama endpoint distinct seats at the same table, while a server-side orchestrator relays their proposals, critiques, and decisions into one visible workflow.

The providers do not open a direct channel to one another. Council is the intermediary: it chooses which outputs to pass into each round, keeps the process bounded, and leaves consequential actions behind a human approval gate.

## What is included

- A focused council workspace with four model seats and clear provider status.
- Structured phases for clarifying, proposing, critiquing, synthesizing, building, and verifying.
- Quick Answer, Council, and Build Lab workflow modes.
- A live activity timeline, shared brief, decision log, artifact area, and controls for pausing or approving work.
- A responsive Vinext/React interface suitable for local preview and Cloudflare deployment.

## Run locally

Council requires Node.js `>=22.13.0`.

```sh
npm run install:ci
npm run dev
```

Open the URL printed by the development server (normally `http://localhost:5173`). To use another port:

```sh
npm run dev -- --port 5174
```

Useful checks and production-preview commands:

```sh
npm run lint
npm run build
npm start
```

`npm start` previews the built Worker locally; it does not deploy the site.

## Demo and live modes

### Demo mode

Demo mode is the automatic fallback when no provider credentials are configured. It uses clearly labelled, simulated council activity so the interface and workflow can be evaluated without network calls, provider accounts, or usage charges. Simulated content must never be presented as a response from a live provider.

The same server route powers demo and live sessions. With no usable credentials it returns deterministic demo turns; when one or more providers are configured it contacts those providers and labels the session as live or partial.

### Live mode

Live mode requires server-side adapters plus credentials for at least one provider. Configured providers participate; an unavailable or unconfigured provider is shown as unavailable rather than silently impersonated. Every provider has separate API access requirements, quotas, rate limits, and charges.

“Meta AI” consumer chat is not embedded. The Llama seat is intended for a configured OpenAI-compatible endpoint that serves a Meta Llama model, and the UI should identify the actual service being used.

## Environment variables

Keep live credentials in `.env.local` for local development or in the deployment platform’s secret store. Never prefix them with `NEXT_PUBLIC_`, commit them, return them to the browser, or include them in logs.

```dotenv
# OpenAI / ChatGPT
OPENAI_API_KEY=
OPENAI_MODEL=

# Anthropic / Claude
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=

# Google / Gemini
GEMINI_API_KEY=
GEMINI_MODEL=

# Meta Llama through an OpenAI-compatible provider
META_API_KEY=
META_API_BASE_URL=
META_MODEL=

# Optional bounded per-provider timeout (5,000–30,000 ms)
COUNCIL_PROVIDER_TIMEOUT_MS=18000
```

Provider requirements:

| Seat | Required for live use | Optional override |
| --- | --- | --- |
| ChatGPT | `OPENAI_API_KEY` | `OPENAI_MODEL` |
| Claude | `ANTHROPIC_API_KEY` | `ANTHROPIC_MODEL` |
| Gemini | `GEMINI_API_KEY` | `GEMINI_MODEL` |
| Llama | `META_API_KEY`, `META_API_BASE_URL`, `META_MODEL` | — |

At least one provider must be configured for a live session. Model names are deliberately configuration values because availability varies by account, region, and provider.

## Orchestration contract

The live implementation keeps the workflow explicit and inspectable:

1. **Clarify** — convert the request into goals, constraints, and acceptance criteria.
2. **Propose** — ask available providers for independent, schema-constrained proposals in parallel.
3. **Critique** — optionally run one bounded peer-review round using concise strengths, risks, missing assumptions, and changes.
4. **Synthesize** — make one server-side synthesizer pass and surface unresolved disagreements.
5. **Review** — present one shared brief while preserving unresolved disagreements.

Council currently stops at the reviewable build brief. A future file runner should wait for approval, run only in a sandbox, and report checks, changes, and known limitations.

Use an all-settled parallel strategy for provider rounds so one timeout or rate limit does not discard the other results. The orchestrator should stream status events, support cancellation, and preserve which provider produced each visible contribution.

## Safety constraints

- API keys stay server-side and are read only from runtime secrets.
- Bound request size, provider timeout, retry count, round count, token use, concurrency, and estimated spend.
- Treat partial provider failure as a normal degraded state; show it clearly and continue with successful seats when safe.
- Never request or display hidden chain-of-thought. Store and show only concise rationales, assumptions, critiques, and decisions.
- Require explicit approval before file writes, arbitrary code execution, deployment, purchases, outbound messages, or destructive operations.
- Run approved build tools in an isolated workspace with narrow filesystem and network permissions.
- Keep demo and live responses visually and semantically distinct.
- Do not treat model agreement as proof. Tests, source checks, and human review remain the final authority.

## Technology

The interface uses React, Next-compatible server components through Vinext, Tailwind CSS, and a Cloudflare Worker entrypoint. Provider calls belong in server-only routes or services; the browser must never call provider APIs with privileged credentials.
