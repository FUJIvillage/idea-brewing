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

export interface GrillOption {
  label: string;
  recommended: boolean;
}

export interface GrillEntry {
  id: string;
  question: string;
  options: GrillOption[];
  answer?: string;
  answeredBy?: "user" | "auto";
  askedAt: string;
}

export interface GrillState {
  entries: GrillEntry[];
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
  number: number; // 1始まり。第2版では常に1
  status: BatchStatus;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export type BuildPhase = "preparing" | "generating" | "verifying" | "repairing";

export interface BuildProgress {
  phase: BuildPhase;
  detail: string;
}

export type BrewStage = "ingredients" | "grilling" | "fermenting" | "done" | "built";

export interface Brew {
  schemaVersion: 1;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  stage: BrewStage;
  ingredients: Ingredient[];
  sheet: BrewSheet | null;
  grill: GrillState;
  recipeProgress: RecipeProgress | null;
  recipeGeneratedAt: string | null;
  batches: BatchRecord[];
  buildProgress: BuildProgress | null;
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
}
