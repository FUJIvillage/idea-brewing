import type { z } from "zod";
import { SHEET_KEYS } from "@/lib/store/types";
import type { GenerateOptions, LlmClient } from "./client";

export interface FakeLlm extends LlmClient {
  calls: GenerateOptions[];
}

export function createFakeClient(): FakeLlm {
  let grillCount = 0;
  const calls: GenerateOptions[] = [];

  const fakeObjectFor = (tag: string): unknown => {
    if (tag === "mash") {
      const field = (sufficiency: string, content: string) => ({ content, sufficiency });
      return {
        concept: field("thin", "原料から推定したコンセプト"),
        targetUsers: field("thin", "想定ユーザー(推定)"),
        features: field("thin", "Must: 中核機能 / Should: 補助機能 / Could: 発展機能"),
        lookAndTone: field("empty", ""),
        successCriteria: field("empty", ""),
        constraints: field("thin", "Webアプリとして実装する"),
        evaluationAxes: field("empty", ""),
      };
    }
    if (tag === "grill-next") {
      grillCount += 1;
      if (grillCount > 2) return { done: true, question: null, options: null };
      return {
        done: false,
        question: `フェイク質問${grillCount}: 方向性はどちらが近いですか?`,
        options: [
          { label: "シンプル重視", recommended: true },
          { label: "多機能重視", recommended: false },
        ],
      };
    }
    if (tag === "grill-apply") {
      return {
        updates: SHEET_KEYS.map((key) => ({
          key,
          content: `回答を反映した ${key} の内容`,
          sufficiency: "full",
        })),
      };
    }
    throw new Error(`fake client: 未対応の tag です: ${tag}`);
  };

  return {
    calls,
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions): Promise<T> {
      calls.push(opts);
      return schema.parse(fakeObjectFor(opts.tag));
    },
    async generateText(opts: GenerateOptions): Promise<string> {
      calls.push(opts);
      if (opts.tag === "connection-test") return "pong";
      return `# フェイク生成ドキュメント\n\n(tag=${opts.tag})\n\n入力の先頭: ${opts.prompt.slice(0, 200)}`;
    },
  };
}
