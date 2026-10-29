import { env } from "cloudflare:workers";

import {
  COUNCIL_PROVIDER_IDS,
  CouncilProviderError,
  type CouncilProviderAdapter,
  type CouncilProviderId,
  type CouncilProviderState,
  type CouncilResponse,
  type CouncilRuntimeEnv,
  type CouncilSynthesis,
  type CouncilTurn,
  createCouncilProviders,
  createDemoCritique,
  createDemoProposal,
  createLocalSynthesis,
} from "@/lib/council-providers";

export const dynamic = "force-dynamic";

const MAX_BODY_CHARS = 32_000;
const MAX_PROMPT_CHARS = 12_000;
const MAX_CONTEXT_CHARS = 28_000;

interface ParsedCouncilRequest {
  prompt: string;
  includeCritique: boolean;
  synthesizer?: CouncilProviderId;
}

class RequestInputError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 413 = 400,
  ) {
    super(message);
    this.name = "RequestInputError";
  }
}

function noStoreJson(body: unknown, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isCouncilProviderId(value: unknown): value is CouncilProviderId {
  return (
    typeof value === "string" &&
    COUNCIL_PROVIDER_IDS.includes(value as CouncilProviderId)
  );
}

async function parseRequest(request: Request): Promise<ParsedCouncilRequest> {
  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_CHARS) {
    throw new RequestInputError("Request body is too large.", 413);
  }

  const rawBody = await request.text();
  if (rawBody.length > MAX_BODY_CHARS) {
    throw new RequestInputError("Request body is too large.", 413);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody) as unknown;
  } catch {
    throw new RequestInputError("Request body must be valid JSON.");
  }

  const body = asRecord(parsed);
  if (!body) throw new RequestInputError("Request body must be a JSON object.");

  if (typeof body.prompt !== "string") {
    throw new RequestInputError("prompt must be a string.");
  }
  const prompt = body.prompt.trim();
  if (!prompt) throw new RequestInputError("prompt is required.");
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new RequestInputError(
      `prompt must be ${MAX_PROMPT_CHARS.toLocaleString()} characters or fewer.`,
      413,
    );
  }

  const mode = body.mode;
  if (mode !== undefined && mode !== "quick" && mode !== "council") {
    throw new RequestInputError('mode must be either "quick" or "council".');
  }
  if (
    body.includeCritique !== undefined &&
    typeof body.includeCritique !== "boolean"
  ) {
    throw new RequestInputError("includeCritique must be a boolean.");
  }

  const requestedSynthesizer = body.synthesizer;
  if (
    requestedSynthesizer !== undefined &&
    requestedSynthesizer !== "auto" &&
    !isCouncilProviderId(requestedSynthesizer)
  ) {
    throw new RequestInputError(
      `synthesizer must be "auto" or one of: ${COUNCIL_PROVIDER_IDS.join(", ")}.`,
    );
  }

  return {
    prompt,
    includeCritique:
      typeof body.includeCritique === "boolean"
        ? body.includeCritique
        : mode !== "quick",
    synthesizer: isCouncilProviderId(requestedSynthesizer)
      ? requestedSynthesizer
      : undefined,
  };
}

function providerStates(
  providers: CouncilProviderAdapter[],
): CouncilProviderState[] {
  return providers.map((provider) => ({
    id: provider.id,
    label: provider.label,
    model: provider.model,
    configured: provider.configured,
    ...(provider.configured
      ? {}
      : { configurationHint: provider.configurationHint }),
  }));
}

function publicProviderError(error: unknown) {
  if (error instanceof CouncilProviderError) return error.message;
  return "The provider request failed unexpectedly.";
}

async function runParallelPhase(
  providers: CouncilProviderAdapter[],
  phase: "proposal" | "critique",
  prompt: string,
  councilContext?: string,
): Promise<CouncilTurn[]> {
  const configured = providers.filter((provider) => provider.configured);
  const jobs = configured.map(async (provider): Promise<CouncilTurn> => {
    const startedAt = Date.now();
    const content = await provider.complete({
      phase,
      userRequest: prompt,
      councilContext,
    });
    return {
      phase,
      providerId: provider.id,
      providerLabel: provider.label,
      model: provider.model,
      status: "succeeded",
      source: "live",
      content,
      latencyMs: Date.now() - startedAt,
    };
  });

  const settled = await Promise.allSettled(jobs);
  const turnsByProvider = new Map<CouncilProviderId, CouncilTurn>();

  settled.forEach((result, index) => {
    const provider = configured[index];
    if (result.status === "fulfilled") {
      turnsByProvider.set(provider.id, result.value);
      return;
    }
    turnsByProvider.set(provider.id, {
      phase,
      providerId: provider.id,
      providerLabel: provider.label,
      model: provider.model,
      status: "failed",
      source: "live",
      error: publicProviderError(result.reason),
    });
  });

  return providers.map(
    (provider) =>
      turnsByProvider.get(provider.id) ?? {
        phase,
        providerId: provider.id,
        providerLabel: provider.label,
        model: provider.model,
        status: "not_configured",
        source: "live",
        error: `Not configured: ${provider.configurationHint}.`,
      },
  );
}

function successfulTurns(turns: CouncilTurn[]) {
  return turns.filter(
    (turn): turn is CouncilTurn & { content: string } =>
      turn.status === "succeeded" && typeof turn.content === "string",
  );
}

function formatCouncilContext(
  sections: Array<{ title: string; turns: CouncilTurn[] }>,
) {
  const chunks: string[] = [];
  let length = 0;

  for (const section of sections) {
    for (const turn of successfulTurns(section.turns)) {
      const chunk = [
        `### ${section.title}: ${turn.providerLabel}`,
        turn.content.slice(0, 6_000),
      ].join("\n");
      if (length + chunk.length > MAX_CONTEXT_CHARS) break;
      chunks.push(chunk);
      length += chunk.length;
    }
  }

  return chunks.join("\n\n");
}

function selectSynthesizer(
  providers: CouncilProviderAdapter[],
  preferred?: CouncilProviderId,
) {
  const configured = providers.filter((provider) => provider.configured);
  return (
    configured.find((provider) => provider.id === preferred) ??
    configured.find((provider) => provider.id === "openai") ??
    configured[0]
  );
}

async function synthesize(
  providers: CouncilProviderAdapter[],
  preferred: CouncilProviderId | undefined,
  prompt: string,
  proposals: CouncilTurn[],
  critiques: CouncilTurn[],
): Promise<CouncilSynthesis> {
  const proposalSuccesses = successfulTurns(proposals);
  const synthesizer = selectSynthesizer(providers, preferred);

  if (!synthesizer || proposalSuccesses.length === 0) {
    return {
      status: "fallback",
      source: "local_fallback",
      providerId: null,
      providerLabel: "Local council fallback",
      model: null,
      content: createLocalSynthesis(prompt, proposalSuccesses, "provider_failure"),
      error: "No live proposal was available for synthesis.",
    };
  }

  const context = formatCouncilContext([
    { title: "Proposal", turns: proposals },
    { title: "Critique", turns: critiques },
  ]);
  const startedAt = Date.now();
  try {
    const content = await synthesizer.complete({
      phase: "synthesis",
      userRequest: prompt,
      councilContext: context,
    });
    return {
      status: "succeeded",
      source: "live",
      providerId: synthesizer.id,
      providerLabel: synthesizer.label,
      model: synthesizer.model,
      content,
      latencyMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      status: "fallback",
      source: "local_fallback",
      providerId: null,
      providerLabel: "Local council fallback",
      model: null,
      content: createLocalSynthesis(prompt, proposalSuccesses, "provider_failure"),
      error: publicProviderError(error),
      latencyMs: Date.now() - startedAt,
    };
  }
}

function buildDemoResponse(
  requestId: string,
  startedAt: number,
  parsed: ParsedCouncilRequest,
  providers: CouncilProviderAdapter[],
): CouncilResponse {
  const proposals: CouncilTurn[] = providers.map((provider) => ({
    phase: "proposal",
    providerId: provider.id,
    providerLabel: provider.label,
    model: provider.model,
    status: "succeeded",
    source: "deterministic_demo",
    content: createDemoProposal(provider.id, parsed.prompt),
  }));
  const critiques: CouncilTurn[] = parsed.includeCritique
    ? providers.map((provider) => ({
        phase: "critique",
        providerId: provider.id,
        providerLabel: provider.label,
        model: provider.model,
        status: "succeeded",
        source: "deterministic_demo",
        content: createDemoCritique(provider.id, provider.label),
      }))
    : [];
  const completedAt = Date.now();

  return {
    requestId,
    mode: "demo",
    notice:
      "No usable provider credentials are configured. Every perspective below is deterministic demo content generated locally; Claude, ChatGPT, Gemini, and Meta / Llama were not contacted.",
    prompt: parsed.prompt,
    providers: providerStates(providers),
    stages: {
      proposals,
      critiques,
      synthesis: {
        status: "succeeded",
        source: "deterministic_demo",
        providerId: null,
        providerLabel: "Deterministic demo synthesizer",
        model: null,
        content: createLocalSynthesis(parsed.prompt, proposals, "demo"),
      },
    },
    meta: {
      critiqueRequested: parsed.includeCritique,
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date(completedAt).toISOString(),
      durationMs: completedAt - startedAt,
    },
  };
}

function liveNotice(
  providers: CouncilProviderAdapter[],
  proposals: CouncilTurn[],
  critiques: CouncilTurn[],
  synthesis: CouncilSynthesis,
  critiqueRequested: boolean,
) {
  const missing = providers
    .filter((provider) => !provider.configured)
    .map((provider) => provider.label);
  const failed = [...proposals, ...critiques]
    .filter((turn) => turn.status === "failed")
    .map((turn) => turn.providerLabel);
  const details: string[] = [];

  if (missing.length) details.push(`Not configured: ${missing.join(", ")}.`);
  if (failed.length) {
    details.push(`Some live calls failed: ${[...new Set(failed)].join(", ")}.`);
  }
  if (synthesis.source === "local_fallback") {
    details.push("The final synthesis is a clearly labeled local fallback.");
  }
  if (!critiqueRequested) details.push("The optional critique round was skipped.");

  return details.length
    ? details.join(" ")
    : "All four configured providers completed the requested council flow.";
}

export async function POST(request: Request) {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();

  try {
    const parsed = await parseRequest(request);
    const providers = createCouncilProviders(env as CouncilRuntimeEnv);
    const configuredCount = providers.filter(
      (provider) => provider.configured,
    ).length;

    if (configuredCount === 0) {
      return noStoreJson(
        buildDemoResponse(requestId, startedAt, parsed, providers),
      );
    }

    const proposals = await runParallelPhase(
      providers,
      "proposal",
      parsed.prompt,
    );
    const proposalContext = formatCouncilContext([
      { title: "Proposal", turns: proposals },
    ]);
    const critiques =
      parsed.includeCritique && successfulTurns(proposals).length > 0
        ? await runParallelPhase(
            providers,
            "critique",
            parsed.prompt,
            proposalContext,
          )
        : [];
    const synthesis = await synthesize(
      providers,
      parsed.synthesizer,
      parsed.prompt,
      proposals,
      critiques,
    );

    const everyProviderConfigured = configuredCount === providers.length;
    const proposalsComplete =
      successfulTurns(proposals).length === providers.length;
    const critiquesComplete =
      !parsed.includeCritique || successfulTurns(critiques).length === providers.length;
    const mode =
      everyProviderConfigured &&
      proposalsComplete &&
      critiquesComplete &&
      synthesis.source === "live"
        ? "live"
        : "partial";
    const completedAt = Date.now();
    const response: CouncilResponse = {
      requestId,
      mode,
      notice: liveNotice(
        providers,
        proposals,
        critiques,
        synthesis,
        parsed.includeCritique,
      ),
      prompt: parsed.prompt,
      providers: providerStates(providers),
      stages: { proposals, critiques, synthesis },
      meta: {
        critiqueRequested: parsed.includeCritique,
        startedAt: new Date(startedAt).toISOString(),
        completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - startedAt,
      },
    };

    return noStoreJson(response);
  } catch (error) {
    if (error instanceof RequestInputError) {
      return noStoreJson(
        { requestId, error: error.message },
        error.status,
      );
    }
    return noStoreJson(
      {
        requestId,
        error: "The council request could not be processed.",
      },
      500,
    );
  }
}
