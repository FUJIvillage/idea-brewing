import type { Locator } from "playwright";

export interface PubElement {
  index: number; // 1始まり。アクションの target に使う
  kind: string; // button / link / textbox など
  label: string; // アクセシブルネーム(なければ表示テキスト)
  value?: string; // 入力系の現在値
}

export interface PubPageState {
  url: string;
  title: string;
  snapshot: string; // ARIAスナップショット等のテキスト要約
  elements: PubElement[];
}

export interface PubAction {
  kind: "click" | "fill" | "select" | "press" | "goto" | "finish";
  target?: number;
  value?: string;
  key?: string;
  path?: string;
  reason: string;
}

export interface PubDriver {
  open(path: string): Promise<void>;
  readState(): Promise<PubPageState>;
  /** アクションを実行し observation を返す。失敗も例外でなく文字列で返す契約 */
  act(action: PubAction): Promise<string>;
  screenshot(filePath: string): Promise<void>;
  close(): Promise<void>;
}

const SNAPSHOT_LIMIT = 8 * 1024;
const MAX_ELEMENTS = 50;
const ACTION_TIMEOUT = 5_000;
const SETTLE_TIMEOUT = 10_000;
const INTERACTIVE_SELECTOR = [
  "button",
  "a[href]",
  "input",
  "textarea",
  "select",
  '[role="button"]',
  '[role="link"]',
  '[role="tab"]',
  '[role="checkbox"]',
].join(", ");

const FAILURE_PREFIX = "操作に失敗しました";

export function isFailureObservation(observation: string): boolean {
  return observation.startsWith(FAILURE_PREFIX);
}

export function truncateSnapshot(text: string): string {
  if (text.length <= SNAPSHOT_LIMIT) return text;
  return `${text.slice(0, SNAPSHOT_LIMIT)}\n(以下省略)`;
}

/** 生成アプリを操作する Playwright ドライバ。ページは 1280x800 の 1 枚を使い回す */
export async function createPlaywrightPubDriver(baseUrl: string): Promise<PubDriver> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  // 直近の readState() が列挙した要素。LLM が指定する target 番号と対応する
  let handles: Locator[] = [];

  /** networkidle まで待つ。タイムアウトしたら false(observation に記録するため) */
  async function settle(): Promise<boolean> {
    try {
      await page.waitForLoadState("networkidle", { timeout: SETTLE_TIMEOUT });
      return true;
    } catch {
      return false;
    }
  }

  return {
    async open(pathname: string): Promise<void> {
      await page.goto(baseUrl + pathname, { timeout: 15_000 });
      await settle();
    },

    async readState(): Promise<PubPageState> {
      const locator = page.locator(INTERACTIVE_SELECTOR);
      // 要素ごとの isVisible / 属性取得の往復を避け、1回の evaluate で全要素分を読み取る。
      // all() の nth ロケータと evaluateAll の配列は同じセレクタの DOM 順なので index が対応する
      const [all, infos] = await Promise.all([
        locator.all(),
        locator
          .evaluateAll((els) =>
            els.map((el) => {
              const rect = el.getBoundingClientRect();
              const visible =
                rect.width > 0 &&
                rect.height > 0 &&
                getComputedStyle(el).visibility !== "hidden";
              const tag = el.tagName.toLowerCase();
              const aria = el.getAttribute("aria-label");
              const raw = (el as HTMLElement).innerText;
              const text = aria ?? (typeof raw === "string" ? raw.trim() : "");
              const isInput = tag === "input" || tag === "textarea" || tag === "select";
              return {
                visible,
                kind: el.getAttribute("role") ?? tag,
                label: (text || el.getAttribute("placeholder") || "").slice(0, 60),
                value: isInput ? (el as HTMLInputElement).value : null,
              };
            }),
          )
          .catch(() => []),
      ]);
      handles = [];
      const elements: PubElement[] = [];
      for (let i = 0; i < all.length && i < infos.length; i++) {
        if (elements.length >= MAX_ELEMENTS) break;
        const info = infos[i];
        if (!info.visible) continue;
        handles.push(all[i]);
        elements.push({
          index: handles.length,
          kind: info.kind,
          label: info.label,
          ...(info.value !== null ? { value: info.value } : {}),
        });
      }
      let snapshot = "";
      try {
        snapshot = await page.locator("body").ariaSnapshot();
      } catch {
        snapshot = await page
          .locator("body")
          .innerText()
          .catch(() => "");
      }
      return {
        url: page.url(),
        title: await page.title().catch(() => ""),
        snapshot: truncateSnapshot(snapshot),
        elements,
      };
    },

    async act(action: PubAction): Promise<string> {
      try {
        switch (action.kind) {
          case "click":
          case "fill":
          case "select": {
            const h = handles[(action.target ?? 0) - 1];
            if (!h) return `${FAILURE_PREFIX}: 対象の要素が見つかりません。`;
            if (action.kind === "click") await h.click({ timeout: ACTION_TIMEOUT });
            if (action.kind === "fill") await h.fill(action.value ?? "", { timeout: ACTION_TIMEOUT });
            if (action.kind === "select")
              await h.selectOption(action.value ?? "", { timeout: ACTION_TIMEOUT });
            break;
          }
          case "press":
            await page.keyboard.press(action.key || "Enter");
            break;
          case "goto": {
            const p = action.path ?? "";
            if (!p.startsWith("/")) return `${FAILURE_PREFIX}: 外部URLへは移動できません。`;
            await page.goto(baseUrl + p, { timeout: 15_000 });
            break;
          }
          case "finish":
            return "セッションを終了しました。";
        }
        const settled = await settle();
        return settled ? "操作に成功しました。" : "操作に成功しました。応答なし(タイムアウト)。";
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 200) : String(err);
        return `${FAILURE_PREFIX}: ${message}`;
      }
    },

    async screenshot(filePath: string): Promise<void> {
      await page.screenshot({ path: filePath });
    },

    async close(): Promise<void> {
      await browser.close();
    },
  };
}
