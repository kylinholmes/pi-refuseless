/**
 * pi-refuseless — registers the Refuseless provider (https://refuseless.com).
 *
 * The model list is fetched from `GET /v1/models` at startup and on every model
 * refresh, so newly added or repriced models appear without a package update.
 *
 * Auth: `REFUSELESS_API_KEY`, or the key already stored by `/login refuseless`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "refuseless";
const BASE_URL = "https://api.refuseless.com/v1";
const AGENT_DIR = process.env.PI_AGENT_DIR ?? join(process.env.USERPROFILE ?? "", ".pi", "agent");

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

async function fetchCatalog(apiKey: string, signal?: AbortSignal): Promise<ChatModel[]> {
  const res = await fetch(`${BASE_URL}/models`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
    signal: signal ?? AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = ((await res.json()) as { data?: RemoteModel[] }).data ?? [];
  return data.map(toPiModel).sort((a, b) => a.id.localeCompare(b.id));
}

export default async function (pi: ExtensionAPI) {
  // Handed to refreshModels as-is instead of rethrowing: offline startup and a
  // failed refresh both keep whatever the previous fetch produced.
  let catalog: ChatModel[] = [];
  const startupKey = resolveApiKey();

  if (startupKey) {
    try {
      catalog = await fetchCatalog(startupKey);
    } catch (error) {
      console.error(`[refuseless] model catalog fetch failed: ${(error as Error).message}`);
    }
  }

  pi.registerProvider(PROVIDER_ID, {
    name: "Refuseless",
    baseUrl: BASE_URL,
    api: "openai-completions",
    apiKey: "$REFUSELESS_API_KEY",
    models: catalog,
    async refreshModels(ctx) {
      const credential = ctx.credential as { key?: string; accessToken?: string } | undefined;
      const key = credential?.key ?? credential?.accessToken ?? startupKey;
      if (!ctx.allowNetwork || !key) return catalog;
      try {
        catalog = await fetchCatalog(key, ctx.signal);
      } catch (error) {
        console.error(`[refuseless] model catalog refresh failed: ${(error as Error).message}`);
      }
      return catalog;
    },
  });
}
