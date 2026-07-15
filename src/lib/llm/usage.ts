import type { GenerateOptions, LlmClient, LlmTag } from "@/lib/llm/client";
import type {
  Brew,
  BrewTokenUsage,
  TokenCounts,
  UsageStageKey,
} from "@/lib/store/types";
import type { z } from "zod";
export { USAGE_STAGE_KEYS } from "@/lib/store/types";
export type { TokenCounts, UsageStageKey, BrewTokenUsage };

const ZERO: TokenCounts = { input: 0, output: 0, total: 0 };

function asNonNegInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** AI SDK / プロバイダごとの usage 形を TokenCounts に正規化する */
export function normalizeUsage(raw: unknown): TokenCounts {
  if (typeof raw !== "object" || raw === null) return { ...ZERO };
  const o = raw as Record<string, unknown>;
  const input = asNonNegInt(o.inputTokens ?? o.promptTokens ?? o.input);
  const output = asNonNegInt(o.outputTokens ?? o.completionTokens ?? o.output);
  const explicitTotal = o.totalTokens ?? o.total;
  const total =
    typeof explicitTotal === "number" && Number.isFinite(explicitTotal) && explicitTotal >= 0
      ? Math.floor(explicitTotal)
      : input + output;
  return { input, output, total };
}

/** LlmTag を集計工程に写す。connection-test は記録しない */
export function stageForTag(tag: LlmTag): UsageStageKey | null {
  switch (tag) {
    case "mash":
      return "mash";
    case "boil-next":
    case "boil-apply":
      return "boil";
    case "recipe":
      return "recipe";
    case "evaluate":
      return "evaluate";
    case "pub-persona":
    case "pub-action":
    case "pub-feedback":
    case "pub-summary":
      return "pub";
    case "connection-test":
      return null;
  }
}

function addCounts(a: TokenCounts, b: TokenCounts): TokenCounts {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    total: a.total + b.total,
  };
}

/** 指定工程に usage を累積した brew を返す(破壊的変更なし) */
export function addTokenUsage(
  brew: Brew,
  stage: UsageStageKey,
  usage: TokenCounts,
): Brew {
  const prev = brew.tokenUsage?.byStage[stage] ?? ZERO;
  return {
    ...brew,
    tokenUsage: {
      byStage: {
        ...brew.tokenUsage?.byStage,
        [stage]: addCounts(prev, usage),
      },
    },
  };
}

/** tag 付き usage を工程に加算。記録対象外なら brew をそのまま返す */
export function addUsageForTag(brew: Brew, tag: LlmTag, usage: TokenCounts): Brew {
  const stage = stageForTag(tag);
  if (!stage) return brew;
  return addTokenUsage(brew, stage, usage);
}

/** 全工程の合計。未計測は 0 */
export function sumTokenUsage(usage: BrewTokenUsage | null | undefined): TokenCounts {
  if (!usage) return { ...ZERO };
  let acc = { ...ZERO };
  for (const counts of Object.values(usage.byStage)) {
    if (counts) acc = addCounts(acc, counts);
  }
  return acc;
}

/**
 * 呼び出しのたびに usage を brew へ累積するラッパー。
 * 長時間パイプライン(Pub/熟成)で呼び出し箇所を増やさずに記録するため。
 */
export function trackingClient(
  client: LlmClient,
  getBrew: () => Brew,
  setBrew: (brew: Brew) => void,
): LlmClient {
  return {
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions) {
      const result = await client.generateObject(schema, opts);
      setBrew(addUsageForTag(getBrew(), opts.tag, result.usage));
      return result;
    },
    async generateText(opts: GenerateOptions) {
      const result = await client.generateText(opts);
      setBrew(addUsageForTag(getBrew(), opts.tag, result.usage));
      return result;
    },
  };
}
