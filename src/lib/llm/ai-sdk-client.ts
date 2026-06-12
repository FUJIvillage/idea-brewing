import { generateObject, generateText, type LanguageModel, type ModelMessage } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { z } from "zod";
import type { Settings } from "@/lib/store/types";
import type { GenerateOptions, LlmClient } from "./client";

export function resolveModel(settings: Settings): LanguageModel {
  switch (settings.provider) {
    case "openai":
      return createOpenAI({ apiKey: settings.apiKey })(settings.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: settings.apiKey })(settings.model);
    case "ollama":
      return createOpenAICompatible({
        name: "ollama",
        baseURL: settings.baseUrl || "http://localhost:11434/v1",
      })(settings.model);
    case "openrouter":
      return createOpenAICompatible({
        name: "openrouter",
        baseURL: "https://openrouter.ai/api/v1",
        apiKey: settings.apiKey,
      })(settings.model);
    default:
      throw new Error(`AI SDK では扱えないプロバイダです: ${settings.provider}`);
  }
}

function toMessages(opts: GenerateOptions): ModelMessage[] {
  if (!opts.images?.length) {
    return [{ role: "user", content: opts.prompt }];
  }
  return [
    {
      role: "user",
      content: [
        { type: "text", text: opts.prompt },
        ...opts.images.map((img) => ({
          type: "image" as const,
          image: img.data,
          mediaType: img.mimeType,
        })),
      ],
    },
  ];
}

export function createAiSdkClient(settings: Settings): LlmClient {
  const model = resolveModel(settings);
  return {
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      const run = async () => {
        const { object } = await generateObject({
          model,
          system: opts.system,
          messages: toMessages(opts),
          schema,
        });
        return object;
      };
      try {
        return await run();
      } catch (firstErr) {
        try {
          return await run(); // パース失敗等は1回だけ自動リトライ
        } catch (secondErr) {
          throw secondErr instanceof Error
            ? new Error(secondErr.message, { cause: firstErr })
            : secondErr;
        }
      }
    },
    async generateText(opts: GenerateOptions): Promise<string> {
      const { text } = await generateText({
        model,
        system: opts.system,
        messages: toMessages(opts),
      });
      return text;
    },
  };
}
