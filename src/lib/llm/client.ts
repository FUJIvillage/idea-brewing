import type { z } from "zod";

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

export interface LlmClient {
  generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T>;
  generateText(opts: GenerateOptions): Promise<string>;
}
