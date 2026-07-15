import type { z } from "zod";
import type { TokenCounts } from "@/lib/llm/usage";

export type LlmTag =
  | "mash"
  | "boil-next"
  | "boil-apply"
  | "recipe"
  | "evaluate"
  | "pub-persona"
  | "pub-action"
  | "pub-feedback"
  | "pub-summary"
  | "connection-test";

export interface LlmImage {
  data: Buffer;
  mimeType: string;
}

export interface GenerateOptions {
  tag: LlmTag;
  system: string;
  prompt: string;
  images?: LlmImage[];
}

export interface LlmResult<T> {
  value: T;
  usage: TokenCounts;
}

export interface LlmClient {
  generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<LlmResult<T>>;
  generateText(opts: GenerateOptions): Promise<LlmResult<string>>;
}
