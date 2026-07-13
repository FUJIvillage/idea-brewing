import { z } from "zod";
import type { LlmClient } from "@/lib/llm/client";
import type { PubPersona, PubPersonaResult, PubStep, PubTaskResult } from "@/lib/store/types";
import { PUB_AXES } from "@/lib/store/types";
import type { CancelToken } from "@/lib/tap/build-state";
import { isFailureObservation, type PubAction, type PubDriver, type PubPageState } from "./driver";

export const MAX_SESSION_STEPS = 15;
const MAX_CONSECUTIVE_FAILURES = 3;

// OpenAIのstrict structured outputsはoptionalプロパティを拒否するため、
// 全フィールド必須+null許容(nullable)にする。nullish(=optional)はNG
const actionSchema = z.object({
  kind: z.enum(["click", "fill", "select", "press", "goto", "finish"]),
  target: z.number().int().min(1).nullable(),
  value: z.string().nullable(),
  key: z.string().nullable(),
  path: z.string().nullable(),
  reason: z.string().min(1),
});

const feedbackSchema = z.object({
  taskResults: z
    .array(z.object({ achieved: z.boolean(), note: z.string() }))
    .min(1)
    .max(3),
  scores: z.object({
    purpose: z.number().int().min(1).max(5),
    usability: z.number().int().min(1).max(5),
    looks: z.number().int().min(1).max(5),
    revisit: z.number().int().min(1).max(5),
  }),
  comment: z.string().min(1),
});

const ACTION_SYSTEM = [
  "あなたは Pub に招かれた客として、目の前の Web アプリを実際に操作します。",
  "与えられたペルソナになりきり、goals を達成するために次の 1 手だけを決めてください。",
  "操作対象はページ状態の要素番号(target)で指定します。",
  "goals を達成できた、またはこれ以上進められないと判断したら kind: finish を選びます。",
].join("\n");

const FEEDBACK_SYSTEM = [
  "あなたは Pub でアプリを試し終えた客です。ペルソナとして正直に評価してください。",
  "taskResults は goals と同じ順番で、達成できたかと経緯を書きます。",
  "scores は 1〜5 の整数(purpose=目的達成 / usability=使いやすさ / looks=見た目・第一印象 / revisit=また来たいか)。",
  "comment は客としての一言レビューです。",
].join("\n");

function personaSection(persona: PubPersona): string {
  return [
    "## あなたのペルソナ",
    `名前: ${persona.name}`,
    `プロフィール: ${persona.profile}`,
    "goals:",
    ...persona.goals.map((g, i) => `${i + 1}. ${g}`),
  ].join("\n");
}

function renderState(state: PubPageState): string {
  return [
    "## 現在のページ",
    `URL: ${state.url}`,
    `タイトル: ${state.title}`,
    "### 操作可能な要素",
    ...(state.elements.length > 0
      ? state.elements.map(
          (e) =>
            `[${e.index}] ${e.kind}「${e.label}」${e.value !== undefined ? `(値: ${e.value})` : ""}`,
        )
      : ["(操作可能な要素が見つかりません)"]),
    "### ページ内容",
    state.snapshot,
  ].join("\n");
}

function buildActionPrompt(persona: PubPersona, steps: PubStep[], state: PubPageState): string {
  const history =
    steps.length > 0
      ? [
          "## これまでの行動",
          ...steps.slice(-5).map((s) => `${s.step}. ${s.action} → ${s.observation}`),
        ]
      : [];
  return [personaSection(persona), ...history, renderState(state)].join("\n\n");
}

function buildFeedbackPrompt(persona: PubPersona, steps: PubStep[]): string {
  return [
    personaSection(persona),
    "## セッションの行動ログ",
    ...steps.map((s) => `${s.step}. ${s.action} → ${s.observation}`),
  ].join("\n");
}

function describeAction(action: PubAction): string {
  const target = action.target != null ? ` [${action.target}]` : "";
  const value = action.value ? ` "${action.value}"` : "";
  const extra = action.key ? ` ${action.key}` : action.path ? ` ${action.path}` : "";
  return `${action.kind}${target}${value}${extra}(${action.reason})`;
}

function toAction(raw: z.infer<typeof actionSchema>): PubAction {
  return {
    kind: raw.kind,
    target: raw.target ?? undefined,
    value: raw.value ?? undefined,
    key: raw.key ?? undefined,
    path: raw.path ?? undefined,
    reason: raw.reason,
  };
}

/** feedback の taskResults を goals と同数・同順に揃える */
export function alignTaskResults(
  goals: string[],
  results: { achieved: boolean; note: string }[],
): PubTaskResult[] {
  return goals.map((goal, i) => ({
    goal,
    achieved: results[i]?.achieved ?? false,
    note: results[i]?.note ?? "回答がありませんでした",
  }));
}

export interface SessionHooks {
  cancel?: CancelToken;
  onStep?: (step: number) => Promise<void> | void;
}

/** 1 ペルソナのセッション(観察→行動ループ→評価聴取)。例外を投げず必ず結果を返す */
export async function runPersonaSession(
  client: LlmClient,
  driver: PubDriver,
  persona: PubPersona,
  hooks: SessionHooks = {},
): Promise<PubPersonaResult> {
  const steps: PubStep[] = [];
  const aborted = (comment: string): PubPersonaResult => ({
    persona,
    status: "aborted",
    taskResults: [],
    scores: [],
    overall: 0,
    comment,
    steps,
  });

  try {
    await driver.open("/");
  } catch {
    return aborted("セッション中断(ページを開けませんでした)");
  }

  let failures = 0;
  for (let step = 1; step <= MAX_SESSION_STEPS; step++) {
    if (hooks.cancel?.cancelled) return aborted("セッション中断(ユーザー中断)");
    try {
      await hooks.onStep?.(step);
    } catch {
      // 進捗通知の失敗でセッションを落とさない(「例外を投げない」契約の維持)
    }

    let action: PubAction;
    try {
      const state = await driver.readState();
      const raw = await client.generateObject(actionSchema, {
        tag: "pub-action",
        system: ACTION_SYSTEM,
        prompt: buildActionPrompt(persona, steps, state),
      });
      action = toAction(raw);
    } catch {
      return aborted("セッション中断(次の操作を決められませんでした)");
    }

    if (action.kind === "finish") {
      steps.push({ step, action: describeAction(action), observation: "客が操作を終えました。" });
      break;
    }

    const needsTarget =
      action.kind === "click" || action.kind === "fill" || action.kind === "select";
    const observation =
      needsTarget && action.target == null
        ? "操作に失敗しました: 対象の要素が指定されていません。"
        : await driver.act(action);
    steps.push({ step, action: describeAction(action), observation });

    failures = isFailureObservation(observation) ? failures + 1 : 0;
    if (failures >= MAX_CONSECUTIVE_FAILURES) {
      return aborted("セッション中断(操作の失敗が続きました)");
    }
  }

  if (hooks.cancel?.cancelled) return aborted("セッション中断(ユーザー中断)");

  try {
    const raw = await client.generateObject(feedbackSchema, {
      tag: "pub-feedback",
      system: FEEDBACK_SYSTEM,
      prompt: buildFeedbackPrompt(persona, steps),
    });
    const scores = [
      { name: PUB_AXES[0], score: raw.scores.purpose, comment: "" },
      { name: PUB_AXES[1], score: raw.scores.usability, comment: "" },
      { name: PUB_AXES[2], score: raw.scores.looks, comment: "" },
      { name: PUB_AXES[3], score: raw.scores.revisit, comment: "" },
    ];
    const overall =
      Math.round((scores.reduce((sum, s) => sum + s.score, 0) / scores.length) * 10) / 10;
    return {
      persona,
      status: "completed",
      taskResults: alignTaskResults(persona.goals, raw.taskResults),
      scores,
      overall,
      comment: raw.comment,
      steps,
    };
  } catch {
    return aborted("セッション中断(評価の聴取に失敗しました)");
  }
}
