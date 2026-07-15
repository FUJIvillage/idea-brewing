export interface MockPromptOptions {
  /** true なら既存 mock.pen を --in で読み込む差分修正モード */
  refine: boolean;
  /** ユーザーの追加指示(任意) */
  instruction?: string;
}

// PoC で確認したゴミ要素(キャンバス外の孤立要素)対策として、全プロンプトに同梱する
const NO_STRAY_ELEMENTS =
  "メインフレームの外に要素を残さないでください。作業用の一時要素はすべて削除してから完了してください。";

/** Pencil CLI エージェントへ渡すプロンプト。レシピ本文は --prompt-file で添付する前提 */
export function buildMockPrompt(opts: MockPromptOptions): string {
  const instruction = opts.instruction?.trim() ?? "";
  if (opts.refine) {
    return [
      "既存のモックアップを、添付のスクリーン仕様(画面構成)とデザインシステムに沿って改善してください。",
      instruction || "仕様との差分を修正して、モックアップの品質を上げてください。",
      NO_STRAY_ELEMENTS,
    ].join("\n");
  }
  return [
    "添付のスクリーン仕様(画面構成)とデザインシステム(色・タイポグラフィ・余白・コンポーネント方針)に厳密に従って、このWebアプリのメイン画面を1枚の高忠実度モックアップとしてデザインしてください。",
    "デザイントークンのカラーコード・スペーシング・角丸・タイポグラフィをそのまま使ってください。",
    "「任意」「表示する場合」と書かれた装飾要素(円形進捗・バッジ・アイコン・アクセントバー等)も必ず描いてください。",
    NO_STRAY_ELEMENTS,
    ...(instruction ? ["", "追加指示:", instruction] : []),
  ].join("\n");
}
