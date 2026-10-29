"use client";

import {
  ArrowUp,
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Code2,
  Copy,
  Eye,
  FileCode2,
  Layers3,
  Menu,
  MoreHorizontal,
  Plus,
  RotateCw,
  Settings2,
  Sparkles,
  Users,
  X,
  Zap,
} from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";

type ProviderId = "claude" | "chatgpt" | "gemini" | "llama";
type RunMode = "quick" | "council" | "build";
type ActiveView = "council" | "artifact";

type ProviderResult = {
  id: ProviderId;
  name: string;
  role: string;
  proposal: string;
  critique?: string;
  status?: "complete" | "unavailable" | "error";
  model?: string;
};

type CouncilResult = {
  title: string;
  summary: string;
  decisions: string[];
  nextSteps: string[];
  files: { name: string; purpose: string }[];
  verdict?: string;
};

type CouncilResponse = {
  demo: boolean;
  mode: RunMode;
  providers: ProviderResult[];
  result: CouncilResult;
  durationMs?: number;
  liveProviders?: ProviderId[];
};

type ApiProviderId = "openai" | "anthropic" | "gemini" | "meta";

type ApiCouncilTurn = {
  providerId: ApiProviderId;
  providerLabel: string;
  model: string;
  status: "succeeded" | "failed" | "not_configured";
  content?: string;
  error?: string;
};

type ApiCouncilResponse = {
  mode: "live" | "partial" | "demo";
  notice: string;
  prompt: string;
  providers: Array<{
    id: ApiProviderId;
    label: string;
    model: string;
    configured: boolean;
  }>;
  stages: {
    proposals: ApiCouncilTurn[];
    critiques: ApiCouncilTurn[];
    synthesis: { content: string; source: string };
  };
  meta: { durationMs: number };
};

const providers: Array<{
  id: ProviderId;
  name: string;
  role: string;
  eyebrow: string;
  badge: string;
}> = [
  {
    id: "claude",
    name: "Claude",
    role: "Product thinker",
    eyebrow: "Structure & nuance",
    badge: "CL",
  },
  {
    id: "chatgpt",
    name: "ChatGPT",
    role: "Lead builder",
    eyebrow: "Systems & execution",
    badge: "GP",
  },
  {
    id: "gemini",
    name: "Gemini",
    role: "Research scout",
    eyebrow: "Context & alternatives",
    badge: "GE",
  },
  {
    id: "llama",
    name: "Llama",
    role: "Red-team critic",
    eyebrow: "Risks & edge cases",
    badge: "LM",
  },
];

const examplePrompt =
  "Design a calm, mobile-first meal planner that turns three pantry ingredients into a week of dinners.";

const initialResponse: CouncilResponse = {
  demo: true,
  mode: "council",
  liveProviders: [],
  providers: [
    {
      id: "claude",
      name: "Claude",
      role: "Product thinker",
      status: "complete",
      proposal:
        "Start with the feeling of relief, not recipe discovery. A three-field pantry input should immediately become a flexible seven-day plan, with clear swaps and almost no setup.",
      critique:
        "Keep the first run guest-friendly. Accounts and nutrition settings can arrive after the user sees a useful plan.",
    },
    {
      id: "chatgpt",
      name: "ChatGPT",
      role: "Lead builder",
      status: "complete",
      proposal:
        "Build one responsive workspace: ingredient chips, a weekly card stack, and a persistent shopping list. Use optimistic state so every swap feels instant.",
      critique:
        "The plan needs a deterministic fallback recipe set so the core journey still works when generation is unavailable.",
    },
    {
      id: "gemini",
      name: "Gemini",
      role: "Research scout",
      status: "complete",
      proposal:
        "Organize suggestions around reuse: cook once, remix twice. Surface dietary assumptions and let people replace an ingredient without regenerating the whole week.",
      critique:
        "Explain why each meal was chosen. That traceability will make generated suggestions feel more trustworthy.",
    },
    {
      id: "llama",
      name: "Llama",
      role: "Red-team critic",
      status: "complete",
      proposal:
        "Treat allergies, budget, and unavailable ingredients as hard constraints. Show uncertainty rather than inventing exact prices or nutrition data.",
      critique:
        "A seven-day result is too dense on a small screen; default to today and reveal the rest progressively.",
    },
  ],
  result: {
    title: "The calm weeknight planner",
    summary:
      "A low-friction planner that transforms what is already in the kitchen into a flexible dinner week, then quietly keeps the shopping list in sync.",
    decisions: [
      "Value before signup",
      "Cook once, remix twice",
      "Hard dietary constraints",
      "Progressive weekly reveal",
    ],
    nextSteps: [
      "Prototype the three-ingredient first run",
      "Test swaps on a narrow mobile viewport",
      "Add a transparent generation fallback",
    ],
    files: [
      { name: "meal-planner.tsx", purpose: "Primary planning experience" },
      { name: "week-card.tsx", purpose: "Responsive daily meal card" },
      { name: "planner.css", purpose: "Calm visual system" },
    ],
    verdict: "Ready to prototype",
  },
};

const modeMeta: Record<RunMode, { label: string; description: string }> = {
  quick: { label: "Quick", description: "Propose + merge" },
  council: { label: "Council", description: "Propose + critique" },
  build: { label: "Build lab", description: "Plan + file brief" },
};

function ProviderMark({ id, badge }: { id: ProviderId; badge: string }) {
  return (
    <span className={`provider-mark provider-${id}`} aria-hidden="true">
      {badge}
    </span>
  );
}

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

const apiProviderMap: Record<ApiProviderId, ProviderId> = {
  openai: "chatgpt",
  anthropic: "claude",
  gemini: "gemini",
  meta: "llama",
};

function cleanModelCopy(value: string | undefined, limit: number) {
  if (!value) return "This seat is not connected yet.";
  const lines = value
    .split("\n")
    .map((line) =>
      line
        .replace(/^#{1,4}\s*/, "")
        .replace(/^\*\*(.+)\*\*:?$/, "$1")
        .replace(/^[-*]\s*/, "")
        .replace(/^\d+[.)]\s*/, "")
        .trim(),
    )
    .filter(
      (line) =>
        line &&
        !/no provider api call|deterministic demo critique|request focus/i.test(line),
    );
  const compact = lines.join(" ").replace(/\s+/g, " ").trim();
  if (compact.length <= limit) return compact;
  const cut = compact.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > limit * 0.7 ? lastSpace : cut.length)}…`;
}

function sectionLines(markdown: string, heading: string) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) =>
    line.toLowerCase().includes(heading.toLowerCase()),
  );
  if (start < 0) return [];
  const section: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,4}\s+/.test(line.trim())) break;
    const clean = line
      .replace(/^[-*]\s*/, "")
      .replace(/^\d+[.)]\s*/, "")
      .replace(/\*\*/g, "")
      .trim();
    if (clean) section.push(clean);
  }
  return section;
}

function titleFromPrompt(prompt: string) {
  const words = prompt.replace(/[.?!]+$/g, "").split(/\s+/).slice(0, 7);
  const title = words.join(" ");
  return title.length > 58 ? `${title.slice(0, 55)}…` : title;
}

function normalizeCouncilResponse(
  raw: ApiCouncilResponse,
  requestedMode: RunMode,
): CouncilResponse {
  const proposals = new Map(
    raw.stages.proposals.map((turn) => [turn.providerId, turn]),
  );
  const critiques = new Map(
    raw.stages.critiques.map((turn) => [turn.providerId, turn]),
  );
  const synthesis = raw.stages.synthesis.content;
  const implementation = sectionLines(synthesis, "Implementation sequence");
  const guardrails = sectionLines(synthesis, "Guardrails");
  const decision = sectionLines(synthesis, "Decision");

  const normalizedProviders: ProviderResult[] = raw.providers.map((provider) => {
    const proposal = proposals.get(provider.id);
    const critique = critiques.get(provider.id);
    const mapped = apiProviderMap[provider.id];
    const local = providers.find((item) => item.id === mapped)!;
    return {
      id: mapped,
      name: local.name,
      role: local.role,
      model: provider.model,
      status:
        proposal?.status === "succeeded"
          ? "complete"
          : proposal?.status === "failed"
            ? "error"
            : "unavailable",
      proposal: cleanModelCopy(proposal?.content ?? proposal?.error, 460),
      critique:
        critique?.status === "succeeded"
          ? cleanModelCopy(critique.content, 260)
          : undefined,
    };
  });

  const summary =
    decision[0] ??
    cleanModelCopy(synthesis, 420) ??
    "The council assembled a bounded direction for review.";
  const fallbackSteps = [
    "Turn the request into goals and acceptance criteria",
    "Build the smallest complete version",
    "Verify the primary path and failure states",
  ];
  const fallbackDecisions = [
    "Keep every provider source visible",
    "Use bounded parallel rounds",
    "Require review before consequential actions",
  ];

  return {
    demo: raw.mode === "demo",
    mode: requestedMode,
    durationMs: raw.meta.durationMs,
    liveProviders: raw.providers
      .filter((provider) => provider.configured)
      .map((provider) => apiProviderMap[provider.id]),
    providers: normalizedProviders,
    result: {
      title: titleFromPrompt(raw.prompt),
      summary,
      decisions: (guardrails.length ? guardrails : fallbackDecisions).slice(0, 4),
      nextSteps: (implementation.length ? implementation : fallbackSteps).slice(0, 4),
      files: [
        { name: "shared-brief.md", purpose: "Goals, constraints, and decisions" },
        { name: "implementation-plan.md", purpose: "Ordered build sequence" },
        { name: "acceptance-checklist.md", purpose: "Verification before handoff" },
      ],
      verdict: raw.mode === "live" ? "Live synthesis ready" : raw.mode === "partial" ? "Partial council ready" : "Demo plan ready",
    },
  };
}

export default function CouncilWorkspace({ displayName }: { displayName: string }) {
  const [prompt, setPrompt] = useState(examplePrompt);
  const [submittedPrompt, setSubmittedPrompt] = useState(examplePrompt);
  const [mode, setMode] = useState<RunMode>("council");
  const [response, setResponse] = useState<CouncilResponse>(initialResponse);
  const [visibleProviders, setVisibleProviders] = useState(4);
  const [isRunning, setIsRunning] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>("council");
  const [artifactView, setArtifactView] = useState<"preview" | "files">("preview");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const runCouncil = useCallback(async () => {
    const cleanPrompt = prompt.trim();
    if (!cleanPrompt || isRunning) return;

    setIsRunning(true);
    setError(null);
    setSubmittedPrompt(cleanPrompt);
    setActiveView("council");
    setVisibleProviders(0);

    const reveal = async () => {
      for (let index = 1; index <= 4; index += 1) {
        await sleep(index === 1 ? 380 : 520);
        setVisibleProviders(index);
      }
    };

    try {
      const request = fetch("/api/council", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: cleanPrompt,
          mode: mode === "quick" ? "quick" : "council",
          includeCritique: mode !== "quick",
        }),
      }).then(async (result) => {
        if (!result.ok) {
          const body = (await result.json().catch(() => null)) as
            | { error?: string }
            | null;
          throw new Error(body?.error || "The council could not complete this round.");
        }
        const raw = (await result.json()) as ApiCouncilResponse;
        return normalizeCouncilResponse(raw, mode);
      });

      const [nextResponse] = await Promise.all([request, reveal()]);
      setResponse(nextResponse);
    } catch (runError) {
      setVisibleProviders(4);
      setError(
        runError instanceof Error
          ? runError.message
          : "The council could not complete this round.",
      );
    } finally {
      setIsRunning(false);
    }
  }, [isRunning, mode, prompt]);

  const newProject = () => {
    setPrompt("");
    setSubmittedPrompt("");
    setResponse(initialResponse);
    setVisibleProviders(0);
    setActiveView("council");
    setSidebarOpen(false);
    setTimeout(() => textareaRef.current?.focus(), 50);
  };

  const copyBrief = async () => {
    const brief = [
      response.result.title,
      response.result.summary,
      "",
      "Decisions",
      ...response.result.decisions.map((item) => `- ${item}`),
      "",
      "Next steps",
      ...response.result.nextSteps.map((item) => `- ${item}`),
    ].join("\n");
    await navigator.clipboard.writeText(brief);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const providerResults = useMemo(
    () =>
      providers.map((provider) => ({
        ...provider,
        result: response.providers.find((item) => item.id === provider.id),
      })),
    [response.providers],
  );

  const liveCount = response.liveProviders?.length ?? 0;
  const progress = isRunning
    ? Math.min(88, 12 + visibleProviders * 17)
    : response.result
      ? 100
      : 0;
  const isMealPlanner = /meal|pantry|dinner|recipe/i.test(submittedPrompt);

  return (
    <main className="council-shell">
      <header className="topbar">
        <button
          className="mobile-menu"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open projects"
        >
          <Menu size={18} />
        </button>
        <a className="wordmark" href="/" aria-label="Council home">
          <span className="wordmark-glyph"><span /><span /><span /></span>
          <span>Council</span>
          <span className="beta-pill">Beta</span>
        </a>

        <div className="topbar-models" aria-label="Council members">
          {providers.map((provider, index) => (
            <div className="topbar-model" key={provider.id}>
              <span className={`mini-dot provider-${provider.id}`} />
              <span>{provider.name}</span>
              {index < providers.length - 1 && <span className="model-plus">+</span>}
            </div>
          ))}
        </div>

        <div className="topbar-actions">
          <button className="icon-button" aria-label="Workspace settings"><Settings2 size={17} /></button>
          <button className="avatar-button" aria-label={`${displayName}'s account`}>
            {displayName.slice(0, 2).toUpperCase()}
          </button>
        </div>
      </header>

      <div className="app-grid">
        <aside className={`project-sidebar ${sidebarOpen ? "is-open" : ""}`}>
          <div className="mobile-sidebar-head">
            <span>Projects</span>
            <button onClick={() => setSidebarOpen(false)} aria-label="Close projects"><X size={18} /></button>
          </div>

          <button className="new-project" onClick={newProject}>
            <Plus size={16} />
            <span>New project</span>
          </button>

          <div className="sidebar-section">
            <p className="sidebar-label">Today</p>
            <button className="project-row is-active">
              <span className="project-icon"><Sparkles size={14} /></span>
              <span><strong>Calm meal planner</strong><small>4 models · just now</small></span>
              <MoreHorizontal size={15} />
            </button>
          </div>

          <div className="sidebar-section">
            <p className="sidebar-label">Recents</p>
            <button className="project-row">
              <span className="project-icon neutral"><Layers3 size={14} /></span>
              <span><strong>Portfolio restructure</strong><small>Build lab · yesterday</small></span>
            </button>
            <button className="project-row">
              <span className="project-icon neutral"><FileCode2 size={14} /></span>
              <span><strong>Launch email sequence</strong><small>Council · 4 days ago</small></span>
            </button>
          </div>

          <div className="sidebar-spacer" />
          <div className="relay-note">
            <span className="relay-icon"><Users size={15} /></span>
            <div><strong>Relay, not a group chat</strong><p>Council passes concise outputs between models—never hidden reasoning.</p></div>
          </div>
          <button className="sidebar-footer">
            <span><Zap size={15} /> Usage this month</span>
            <strong>{response.demo ? "Demo" : "Live"}</strong>
          </button>
        </aside>

        {sidebarOpen && <button className="sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-label="Close projects" />}

        <section className="workspace">
          <div className="workspace-head">
            <div className="workspace-kicker">
              <span className={`connection-dot ${response.demo ? "is-demo" : "is-live"}`} />
              {response.demo
                ? "Interactive demo · connect APIs for live answers"
                : `Live council · ${liveCount} provider${liveCount === 1 ? "" : "s"} connected`}
            </div>
            <div className="workspace-title-row">
              <div>
                <h1>One brief. Four perspectives.</h1>
                <p>They propose independently, challenge one another, then hand you one buildable direction.</p>
              </div>
              <button className="round-button" onClick={runCouncil} disabled={isRunning || !prompt.trim()}>
                <RotateCw size={15} className={isRunning ? "spin" : ""} /> Another round
              </button>
            </div>
          </div>

          <div className="view-tabs" role="tablist" aria-label="Workspace view">
            <button role="tab" aria-selected={activeView === "council"} className={activeView === "council" ? "is-active" : ""} onClick={() => setActiveView("council")}>Council <span>4</span></button>
            <button role="tab" aria-selected={activeView === "artifact"} className={activeView === "artifact" ? "is-active" : ""} onClick={() => setActiveView("artifact")}>Shared artifact <span>{response.result.files.length}</span></button>
          </div>

          <div className="workspace-scroll">
            {activeView === "council" ? (
              <div className="council-view">
                {submittedPrompt ? (
                  <section className="brief-card">
                    <div className="brief-meta"><span>Your brief</span><span>{modeMeta[response.mode].label} mode</span></div>
                    <p>{submittedPrompt}</p>
                  </section>
                ) : (
                  <section className="empty-state">
                    <div className="empty-glyph"><Sparkles size={22} /></div>
                    <h2>What should the council build?</h2>
                    <p>Describe a product, page, plan, or problem. You stay in control of the final direction.</p>
                  </section>
                )}

                {(submittedPrompt || isRunning) && (
                  <section className="round-section">
                    <div className="section-heading">
                      <span className="step-number">01</span>
                      <div><h2>Independent proposals</h2><p>Fresh reads first, before group influence.</p></div>
                      <span className="section-status">{isRunning ? `${visibleProviders}/4 reporting` : "Round complete"}</span>
                    </div>

                    <div className="provider-grid">
                      {providerResults.map((provider, index) => {
                        const isVisible = index < visibleProviders;
                        const result = provider.result;
                        return (
                          <article key={provider.id} className={`provider-card provider-card-${provider.id} ${isVisible ? "is-visible" : "is-pending"}`}>
                            <div className="provider-card-head">
                              <ProviderMark id={provider.id} badge={provider.badge} />
                              <div>
                                <div className="provider-name-line"><h3>{provider.name}</h3>{isVisible && <CheckCircle2 size={14} />}</div>
                                <p>{provider.role}</p>
                              </div>
                              <span className="provider-eyebrow">{provider.eyebrow}</span>
                            </div>
                            {isVisible && result ? (
                              <div className="provider-copy">
                                <p>{result.proposal}</p>
                                {result.critique && response.mode !== "quick" && (
                                  <div className="critique-note"><span>Challenge</span><p>{result.critique}</p></div>
                                )}
                              </div>
                            ) : (
                              <div className="thinking-state"><span /><span /><span /><p>{isRunning ? "Reading the brief…" : "Waiting for a new round"}</p></div>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  </section>
                )}

                {visibleProviders === 4 && submittedPrompt && (
                  <section className="synthesis-section">
                    <div className="synthesis-line" aria-hidden="true">
                      {providers.map((provider) => <span key={provider.id} className={`provider-${provider.id}`} />)}
                      <i />
                    </div>
                    <div className="section-heading synthesis-heading">
                      <span className="step-number">02</span>
                      <div><h2>Shared direction</h2><p>Agreement, tension, and the next concrete move.</p></div>
                      <span className="verdict-pill"><Check size={12} /> {response.result.verdict ?? "Ready"}</span>
                    </div>

                    <article className="result-card">
                      <div className="result-copy">
                        <span className="result-label">Council synthesis</span>
                        <h2>{response.result.title}</h2>
                        <p>{response.result.summary}</p>
                        <div className="decision-tags">
                          {response.result.decisions.map((decision) => <span key={decision}><Check size={12} /> {decision}</span>)}
                        </div>
                      </div>
                      <div className="next-steps">
                        <div className="next-steps-head"><span>Build sequence</span><span>{response.result.nextSteps.length} steps</span></div>
                        <ol>
                          {response.result.nextSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}
                        </ol>
                        <button className="open-artifact" onClick={() => setActiveView("artifact")}>Open shared artifact <ArrowUp size={14} /></button>
                      </div>
                    </article>
                  </section>
                )}

                {error && (
                  <div className="error-banner" role="alert"><Circle size={10} fill="currentColor" /><span>{error}</span><button onClick={runCouncil}>Try again</button></div>
                )}
              </div>
            ) : (
              <div className="artifact-view">
                <section className="artifact-toolbar">
                  <div><span>Shared artifact</span><h2>{response.result.title}</h2></div>
                  <div className="artifact-actions">
                    <div className="segmented-control">
                      <button className={artifactView === "preview" ? "is-active" : ""} onClick={() => setArtifactView("preview")}><Eye size={14} /> Preview</button>
                      <button className={artifactView === "files" ? "is-active" : ""} onClick={() => setArtifactView("files")}><Code2 size={14} /> Files</button>
                    </div>
                    <button className="copy-button" onClick={copyBrief}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Copied" : "Copy brief"}</button>
                  </div>
                </section>

                {artifactView === "preview" ? (
                  <div className="preview-stage">
                    <div className="preview-window">
                      <div className="preview-chrome"><span /><span /><span /><div>council.build/preview</div></div>
                      {isMealPlanner ? (
                        <div className="preview-page">
                          <div className="preview-nav"><strong>mise</strong><div><span>Tonight</span><span>My week</span><button>Start planning</button></div></div>
                          <div className="preview-hero">
                            <span className="preview-kicker">DINNER, WITHOUT THE DECISION FATIGUE</span>
                            <h3>What’s already<br />in your kitchen?</h3>
                            <p>Three ingredients become a thoughtful week of dinners.</p>
                            <div className="ingredient-row">
                              <span>Chickpeas <X size={11} /></span><span>Tomatoes <X size={11} /></span><span>Spinach <X size={11} /></span><button><ArrowUp size={14} /></button>
                            </div>
                          </div>
                          <div className="meal-cards">
                            <article><small>MONDAY · 25 MIN</small><strong>Smoky chickpea skillet</strong><span>Uses 3 pantry staples</span></article>
                            <article><small>TUESDAY · 20 MIN</small><strong>Tomato greens orzo</strong><span>Reuses Monday’s prep</span></article>
                            <article><small>WEDNESDAY · 15 MIN</small><strong>Crispy chickpea bowls</strong><span>Flexible by design</span></article>
                          </div>
                        </div>
                      ) : (
                        <div className="preview-page generic-preview">
                          <div className="preview-nav"><strong>draft/01</strong><div><span>Brief</span><span>Prototype</span><button>Review direction</button></div></div>
                          <div className="generic-preview-hero">
                            <span className="preview-kicker">COUNCIL-APPROVED DIRECTION</span>
                            <h3>{response.result.title}</h3>
                            <p>{response.result.summary}</p>
                            <button>Start with the shared brief <ArrowUp size={14} /></button>
                          </div>
                          <div className="plan-cards">
                            {response.result.decisions.slice(0, 3).map((decision, index) => (
                              <article key={decision}><small>0{index + 1} · DECISION</small><strong>{decision}</strong><span>Accepted by the council</span></article>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                    <p className="preview-caption">Illustrative preview generated from the council’s shared direction.</p>
                  </div>
                ) : (
                  <div className="file-list">
                    <div className="file-tree-head"><span>Planned files</span><span>Purpose</span></div>
                    {response.result.files.map((file) => (
                      <div className="file-row" key={file.name}><span className="file-icon"><FileCode2 size={15} /></span><strong>{file.name}</strong><p>{file.purpose}</p><span className="file-ready">planned</span></div>
                    ))}
                    <div className="file-callout"><Sparkles size={17} /><div><strong>Plan before execution</strong><p>Council creates a reviewable build brief. Connecting a sandboxed runner is the next step for autonomous file generation and tests.</p></div></div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="composer-dock">
            <div className="composer">
              <textarea
                ref={textareaRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    event.preventDefault();
                    void runCouncil();
                  }
                }}
                placeholder="Describe what you want the council to build…"
                rows={2}
                aria-label="Your brief"
              />
              <div className="composer-footer">
                <div className="mode-picker-wrap">
                  <button className="mode-picker" onClick={() => setDetailsOpen((open) => !open)}>
                    <span className="mode-icon"><Users size={14} /></span>
                    <span><strong>{modeMeta[mode].label}</strong><small>{modeMeta[mode].description}</small></span>
                    <ChevronDown size={14} />
                  </button>
                  {detailsOpen && (
                    <div className="mode-menu">
                      {(Object.keys(modeMeta) as RunMode[]).map((option) => (
                        <button key={option} className={mode === option ? "is-active" : ""} onClick={() => { setMode(option); setDetailsOpen(false); }}>
                          <span><strong>{modeMeta[option].label}</strong><small>{modeMeta[option].description}</small></span>
                          {mode === option && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="composer-hint">⌘ + Enter</div>
                <button className="send-button" onClick={runCouncil} disabled={isRunning || !prompt.trim()} aria-label={isRunning ? "Council is working" : "Run council"}>
                  {isRunning ? <span className="stop-glyph" /> : <ArrowUp size={18} />}
                </button>
              </div>
              {isRunning && <div className="composer-progress" style={{ "--progress": `${progress}%` } as React.CSSProperties} />}
            </div>
            <p className="disclaimer">Council relays selected outputs between independent APIs. Review important decisions before acting.</p>
          </div>
        </section>

        <aside className="decision-rail">
          <div className="rail-head">
            <div><span>Working memory</span><h2>Shared brief</h2></div>
            <button aria-label="More brief options"><MoreHorizontal size={17} /></button>
          </div>
          <div className="brief-progress"><div><span style={{ width: `${progress}%` }} /></div><p><strong>{progress}%</strong> {isRunning ? "Council in session" : "Direction aligned"}</p></div>

          <div className="rail-section">
            <div className="rail-section-title"><span>Accepted decisions</span><small>{response.result.decisions.length}</small></div>
            <ul className="decision-list">
              {response.result.decisions.map((decision) => <li key={decision}><span><Check size={11} /></span>{decision}</li>)}
            </ul>
          </div>

          <div className="rail-section">
            <div className="rail-section-title"><span>Model roles</span><small>4</small></div>
            <div className="role-list">
              {providers.map((provider) => (
                <div key={provider.id}><span className={`role-dot provider-${provider.id}`} /><p><strong>{provider.name}</strong><small>{provider.role}</small></p><Check size={13} /></div>
              ))}
            </div>
          </div>

          <div className="rail-spacer" />
          <div className="consensus-card">
            <div className="consensus-orbit" aria-hidden="true">
              {providers.map((provider) => <span key={provider.id} className={`provider-${provider.id}`} />)}
              <i><Check size={15} /></i>
            </div>
            <div><span>Consensus signal</span><strong>Strong alignment</strong></div>
          </div>
          <button className="copy-rail" onClick={copyBrief}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? "Brief copied" : "Copy shared brief"}</button>
        </aside>
      </div>
    </main>
  );
}
