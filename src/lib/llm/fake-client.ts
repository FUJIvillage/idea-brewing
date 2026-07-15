import type { z } from "zod";
import { SHEET_KEYS } from "@/lib/store/types";
import type { GenerateOptions, LlmClient } from "./client";

export interface FakeLlm extends LlmClient {
  calls: GenerateOptions[];
}

export function createFakeClient(): FakeLlm {
  let boilCount = 0;
  let evaluateCount = 0;
  let pubActionCount = 0;
  let pubFeedbackCount = 0;
  const calls: GenerateOptions[] = [];

  const fakeObjectFor = (opts: GenerateOptions): unknown => {
    const tag = opts.tag;
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
    if (tag === "boil-next") {
      boilCount += 1;
      if (boilCount > 2) return { done: true, question: null, options: null };
      return {
        done: false,
        question: `フェイク質問${boilCount}: 方向性はどちらが近いですか?`,
        options: [
          { label: "シンプル重視", recommended: true },
          { label: "多機能重視", recommended: false },
        ],
      };
    }
    if (tag === "boil-apply") {
      return {
        updates: SHEET_KEYS.map((key) => ({
          key,
          content: `回答を反映した ${key} の内容`,
          sufficiency: "full",
        })),
      };
    }
    if (tag === "evaluate") {
      evaluateCount += 1;
      const score = evaluateCount === 1 ? 3 : 5; // 2回目以降は改善済みとして高評価(autoループの停止テスト用)
      return {
        axes: [
          { name: "機能完成度", score, comment: `フェイク講評(${evaluateCount}回目)` },
          { name: "UI/UX", score, comment: `フェイク講評(${evaluateCount}回目)` },
        ],
        summary: `フェイク総評(${evaluateCount}回目)`,
        improvements: ["見出しの階層を整理する", "主要ボタンのコントラストを上げる"],
        strategy: "repair",
      };
    }
    if (tag === "pub-persona") {
      const count = Number(/人数: (\d+)/.exec(opts.prompt)?.[1] ?? "2");
      return {
        personas: Array.from({ length: count }, (_, i) => ({
          name: `フェイク客${i + 1}`,
          profile: "フェイクのペルソナ(自動生成)",
          goals: ["トップページを確認する", "主要機能をひとつ試す"],
        })),
      };
    }
    if (tag === "pub-action") {
      pubActionCount += 1;
      if (pubActionCount % 2 === 1) {
        return {
          kind: "click",
          target: 1,
          value: null,
          key: null,
          path: null,
          reason: `フェイク操作${pubActionCount}`,
        };
      }
      return {
        kind: "finish",
        target: null,
        value: null,
        key: null,
        path: null,
        reason: "目的を確認できたので終了",
      };
    }
    if (tag === "pub-feedback") {
      pubFeedbackCount += 1;
      const high = pubFeedbackCount === 1; // 1人目は高評価(リーダーボード検証を決定論化)
      return {
        taskResults: [
          { achieved: true, note: "フェイクで達成" },
          { achieved: high, note: "フェイクの経緯" },
        ],
        scores: high
          ? { purpose: 5, usability: 4, looks: 4, revisit: 5 }
          : { purpose: 4, usability: 3, looks: 3, revisit: 3 },
        comment: `フェイク客レビュー(${pubFeedbackCount}人目)`,
      };
    }
    throw new Error(`fake client: 未対応の tag です: ${tag}`);
  };

  return {
    calls,
    async generateObject<T>(schema: z.ZodType<T>, opts: GenerateOptions) {
      calls.push(opts);
      return {
        value: schema.parse(fakeObjectFor(opts)),
        usage: { input: 11, output: 22, total: 33 },
      };
    },
    async generateText(opts: GenerateOptions) {
      calls.push(opts);
      const text =
        opts.tag === "connection-test"
          ? "pong"
          : opts.tag === "pub-summary"
            ? "フェイク総括: 客の評判は上々です。"
            : `# フェイク生成ドキュメント\n\n(tag=${opts.tag})\n\n入力の先頭: ${opts.prompt.slice(0, 200)}`;
      return { value: text, usage: { input: 11, output: 22, total: 33 } };
    },
  };
}
