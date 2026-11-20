/**
 * pi-refuseless — registers the Refuseless provider (https://refuseless.com).
 *
 * Startup never touches the network: a bundled catalog is registered
 * synchronously, so model selection works immediately and offline. Pi refreshes
 * providers in the background afterwards, and `refreshModels` then swaps in
 * `GET /v1/models` and persists it for the next offline start.
 *
 * Auth: `REFUSELESS_API_KEY`, or the key already stored by `/login refuseless`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ModelsStoreEntry } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "refuseless";
const BASE_URL = "https://api.refuseless.com/v1";
const AGENT_DIR = process.env.PI_AGENT_DIR ?? join(process.env.USERPROFILE ?? "", ".pi", "agent");

/** Reuse the persisted catalog for this long; `force` refreshes bypass the window. */
const REFRESH_INTERVAL_MS = 4 * 60 * 60 * 1000;

type RemoteModel = {
  id: string;
  vision?: boolean;
  context_length?: number;
  reasoning_efforts?: string[];
  reasoning_default?: string;
  pricing?: {
    input_per_m?: number;
    cached_input_per_m?: number;
    output_per_m?: number;
    regular?: { input_per_m?: number; cached_input_per_m?: number; output_per_m?: number };
  };
};

function resolveApiKey(): string | undefined {
  if (process.env.REFUSELESS_API_KEY) return process.env.REFUSELESS_API_KEY;
  try {
    const cred = JSON.parse(readFileSync(join(AGENT_DIR, "auth.json"), "utf8"))?.[PROVIDER_ID];
    return cred?.type === "api_key" ? cred.key : (cred?.access ?? undefined);
  } catch {
    return undefined;
  }
}

/** `reasoning` is required only on the chat variant, which makes it the discriminator. */
type ChatModel = Extract<ProviderModelConfig, { reasoning: boolean }>;

const titleCase = (id: string) =>
  id
    .split(/[-_]/)
    .map((word) => (/^[a-z]/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(" ");

/** Discounted rates win over `regular`, which is the un-discounted list price. */
function buildCost(remote: RemoteModel): ProviderModelConfig["cost"] {
  const price = remote.pricing ?? {};
  const per = (value?: number, regular?: number) => value ?? regular ?? 0;
  return {
    input: per(price.input_per_m, price.regular?.input_per_m),
    output: per(price.output_per_m, price.regular?.output_per_m),
    cacheRead: per(price.cached_input_per_m, price.regular?.cached_input_per_m),
    cacheWrite: 0,
  };
}

/**
 * Builds the level map from the advertised effort levels: the provider rejects
 * anything outside them, so unsupported levels become null and pi clamps to the
 * nearest supported one.
 */
function buildThinkingMap(
  remote: RemoteModel,
): ChatModel["thinkingLevelMap"] | undefined {
  const efforts = remote.reasoning_efforts ?? [];
  if (efforts.length === 0) return undefined;

  const published = (level: string) => (efforts.includes(level) ? level : null);
  const fallback =
    remote.reasoning_default && remote.reasoning_default !== "off"
      ? remote.reasoning_default
      : (published("low") ?? efforts[0] ?? "low");

  return {
    off: published("off"),
    minimal: null,
    low: published("low") ?? fallback,
    medium: fallback,
    high: published("high") ?? fallback,
    max: published("max") ?? published("high") ?? fallback,
  };
}

function toPiModel(remote: RemoteModel): ChatModel {
  const thinkingLevelMap = buildThinkingMap(remote);
  return {
    id: remote.id,
    name: titleCase(remote.id),
    reasoning: thinkingLevelMap !== undefined,
    input: remote.vision ? ["text", "image"] : ["text"],
    cost: buildCost(remote),
    contextWindow: remote.context_length ?? 131072,
    maxTokens: 65536,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
  };
}

/**
 * `GET /v1/models` as of this release. Registered synchronously so `pi` starts
 * without waiting on the network; a successful refresh replaces and persists it.
 */
const DEFAULT_CATALOG: ChatModel[] = [
  {
    id: "deepseek-v4.1-flash-abliterated",
    name: "Deepseek V4.1 Flash Abliterated",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.12, output: 0.45, cacheRead: 0.019, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: "off", minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
  {
    id: "deepseek-v4.1-flash-abliterated-fast",
    name: "Deepseek V4.1 Flash Abliterated Fast",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.12, output: 0.45, cacheRead: 0.025, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: "off", minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
  {
    id: "deepseek-v4.1-flash-fast",
    name: "Deepseek V4.1 Flash Fast",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.01, output: 0.08, cacheRead: 0.002, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: "off", minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
  {
    id: "glm-5.3-abliterated",
    name: "Glm 5.3 Abliterated",
    reasoning: true,
    input: ["text"],
    cost: { input: 1, output: 2, cacheRead: 0.15, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
  {
    id: "glm-5.3-flash-abliterated",
    name: "Glm 5.3 Flash Abliterated",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.12, output: 0.5, cacheRead: 0.025, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
  {
    id: "kimi-k3.1-pro",
    name: "Kimi K3.1 Pro",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.25, output: 2.5, cacheRead: 0.15, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
  {
    id: "kimi-k3.1-pro-abliterated",
    name: "Kimi K3.1 Pro Abliterated",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 1.5, output: 3, cacheRead: 0.15, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
  {
    id: "minimax-m3.1-flash",
    name: "Minimax M3.1 Flash",
    reasoning: true,
    input: ["text", "image"],
    cost: { input: 0.02, output: 0.08, cacheRead: 0.002, cacheWrite: 0 },
    contextWindow: 1048576,
    maxTokens: 65536,
    thinkingLevelMap: { off: null, minimal: null, low: "low", medium: "low", high: "high", max: "max" },
  },
];

/**
 * Drops the config-only typing before persisting: pi stores catalogs as
 * `AnyModel[]` and re-validates on read, so the chat fields carried here are
 * exactly what it expects back.
 */
function toStoreModels(models: ChatModel[]): ModelsStoreEntry["models"] {
  // SAFETY: every entry is a fully formed chat model — `toPiModel` always sets
  // `input`, `cost`, `contextWindow`, and `maxTokens`, the fields `AnyModel`
  // requires; pi adds `type` back when it rehydrates the stored catalog.
  return models as unknown as ModelsStoreEntry["models"];
}

async function fetchCatalog(apiKey: string, signal?: AbortSignal): Promise<ChatModel[]> {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = ((await res.json()) as { data?: RemoteModel[] }).data ?? [];
  return data.map(toPiModel).sort((a, b) => a.id.localeCompare(b.id));
}

export default function (pi: ExtensionAPI) {
  // Pi refreshes providers after startup, so this list is replaced in the
  // background rather than blocking the factory on a network round trip.
  let catalog: ChatModel[] = DEFAULT_CATALOG;

  pi.registerProvider(PROVIDER_ID, {
    name: "Refuseless",
    baseUrl: BASE_URL,
    api: "openai-completions",
    apiKey: "$REFUSELESS_API_KEY",
    models: catalog,
    async refreshModels(ctx) {
      // Phase one runs offline to restore the persisted catalog; adopting it
      // here keeps later phases and the returned list in sync.
      const stored = ctx.stored?.models as ChatModel[] | undefined;
      if (stored && stored.length > 0) catalog = stored;

      if (!ctx.allowNetwork || ctx.signal.aborted) return catalog;

      const credential = ctx.credential as { key?: string; accessToken?: string } | undefined;
      const key = credential?.key ?? credential?.accessToken ?? resolveApiKey();
      if (!key) return catalog;

      const checkedAt = ctx.stored?.checkedAt;
      if (!ctx.force && checkedAt !== undefined && Date.now() - checkedAt < REFRESH_INTERVAL_MS) {
        return catalog;
      }

      try {
        const fresh = await fetchCatalog(key, ctx.signal);
        if (ctx.signal.aborted || fresh.length === 0) return catalog;
        catalog = fresh;
        await ctx.publish({
          persist: { models: toStoreModels(fresh), checkedAt: Date.now() },
        });
      } catch (error) {
        // Keep the bundled or persisted catalog so a failed refresh (or an
        // offline start) still leaves /model populated.
        console.error(`[refuseless] model catalog refresh failed: ${(error as Error).message}`);
      }
      return catalog;
    },
  });
}
