import type { PubAction, PubDriver, PubPageState } from "./driver";

export interface FakePubDriver extends PubDriver {
  actions: PubAction[];
}

/** 実ブラウザを起動しないフェイクドライバ(fake モード・単体テスト用) */
export function createFakePubDriver(): FakePubDriver {
  const actions: PubAction[] = [];
  const state: PubPageState = {
    url: "http://localhost:0/",
    title: "フェイクタップアプリ",
    snapshot: "heading: フェイクタップアプリ",
    elements: [{ index: 1, kind: "button", label: "フェイクボタン" }],
  };
  return {
    actions,
    async open(): Promise<void> {},
    async readState(): Promise<PubPageState> {
      return state;
    },
    async act(action: PubAction): Promise<string> {
      actions.push(action);
      return "操作に成功しました。";
    },
    async screenshot(): Promise<void> {
      // fake モードではスクリーンショットを保存しない(設計 §7)
    },
    async close(): Promise<void> {},
  };
}
