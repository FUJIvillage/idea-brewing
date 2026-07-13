export type Sufficiency = "full" | "thin" | "empty";

export const SHEET_KEYS = [
  "concept",
  "targetUsers",
  "features",
  "lookAndTone",
  "successCriteria",
  "constraints",
  "evaluationAxes",
] as const;
export type SheetKey = (typeof SHEET_KEYS)[number];

export const SHEET_LABELS: Record<SheetKey, string> = {
  concept: "コンセプト",
  targetUsers: "ターゲットユーザーとコアジョブ",
  features: "主要機能(Must/Should/Could)",
  lookAndTone: "見た目とトーン",
  successCriteria: "成功基準",
  constraints: "制約",
  evaluationAxes: "自己評価の観点",
};

export interface SheetField {
  content: string;
  sufficiency: Sufficiency;
  userEdited: boolean;
}

export type BrewSheet = Record<SheetKey, SheetField>;

export type IngredientKind = "text" | "url" | "image" | "document";

export interface Ingredient {
  id: string;
  kind: IngredientKind;
  title: string;
  text?: string;
  filePath?: string;
  mimeType?: string;
  status: "ok" | "failed";
  error?: string;
  addedAt: string;
}

export interface BoilOption {
  label: string;
  recommended: boolean;
}

export interface BoilEntry {
  id: string;
  question: string;
  options: BoilOption[];
  answer?: string;
  answeredBy?: "user" | "auto";
  askedAt: string;
}

export interface BoilState {
  entries: BoilEntry[];
  auto: boolean;
  finished: boolean;
}

export interface RecipeProgress {
  current: number;
  total: number;
  file: string;
}

export type BatchStatus = "building" | "succeeded" | "failed" | "cancelled";

export interface BatchRecord {
  number: number; // 1始まり
  status: BatchStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  evaluation: BatchEvaluation | null;
  pub: PubReport | null;
}

export type BuildPhase = "preparing" | "generating" | "verifying" | "repairing";

export interface BuildProgress {
  phase: BuildPhase;
  detail: string;
}

export interface AxisScore {
  name: string; // ルーブリックの観点名
  score: number; // 1〜5
  comment: string;
}

export type NextBatchStrategy = "repair" | "rebuild";

export interface BatchEvaluation {
  overall: number; // axes の平均(小数1桁)
  axes: AxisScore[];
  summary: string;
  improvements: string[]; // 次バッチへの改善指示
  strategy: NextBatchStrategy;
  screenshotsUsed: boolean; // スクリーンショットを採点に使えたか
  evaluatedAt: string;
}

export type MaturationPhase = "screenshotting" | "evaluating" | "planning" | "building";

export interface MaturationProgress {
  phase: MaturationPhase;
  detail: string;
  batch: number; // 対象バッチ番号
}

export const PUB_AXES = ["目的達成", "使いやすさ", "見た目・第一印象", "また来たいか"] as const;

export interface PubPersona {
  name: string; // 例: "忙しい営業のさとみ"
  profile: string; // 属性・利用文脈・性格
  goals: string[]; // このアプリで達成したいこと(1〜3件)
  origin: "auto" | "saved"; // 自動生成 or 常連客
}

export interface SavedPersona {
  id: string;
  name: string;
  profile: string;
  goals: string[];
}

export interface PubTaskResult {
  goal: string;
  achieved: boolean;
  note: string; // 達成/断念の経緯
}

export interface PubStep {
  step: number; // 1始まり
  action: string; // 例: `click [3](追加ボタンを押す)`
  observation: string; // 実行結果の要約
}

export type PubPersonaStatus = "completed" | "aborted";

export interface PubPersonaResult {
  persona: PubPersona;
  status: PubPersonaStatus; // aborted = LLM失敗・連続操作失敗など
  taskResults: PubTaskResult[];
  scores: AxisScore[]; // PUB_AXES 固定4軸
  overall: number; // 4軸平均(小数1桁)。aborted 時は 0 で集計対象外
  comment: string; // 客の一言レビュー
  steps: PubStep[]; // 行動ログ
}

export interface PubReport {
  overall: number; // completed ペルソナの overall 平均(小数1桁)
  personaResults: PubPersonaResult[];
  summary: string; // 店主向け総括
  ranAt: string;
}

export type PubPhase = "opening" | "serving" | "closing";

export interface PubProgress {
  phase: PubPhase;
  detail: string; // 例: "ペルソナ 2/3「…」: ステップ 4"
  batch: number;
}

export type BrewStage = "ingredients" | "boiling" | "fermenting" | "done" | "built";

export interface Brew {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  stage: BrewStage;
  ingredients: Ingredient[];
  sheet: BrewSheet | null;
  boil: BoilState;
  recipeProgress: RecipeProgress | null;
  recipeGeneratedAt: string | null;
  batches: BatchRecord[];
  buildProgress: BuildProgress | null;
  maturationProgress: MaturationProgress | null;
  pubProgress: PubProgress | null;
}

export type ProviderId = "openai" | "google" | "ollama" | "openrouter" | "fake";

export interface Settings {
  provider: ProviderId;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** Cursor SDK(タップ工程)のAPIキー。空なら環境変数 CURSOR_API_KEY にフォールバック */
  cursorApiKey: string;
  /** タップ工程で使うモデルID */
  cursorModel: string;
  /** タップ工程の Cursor モデル effort (例: max)。空なら SDK 既定 */
  cursorEffort: string;
}
