import { promises as fs } from "node:fs";
import path from "node:path";

export const DESIGN_SPEC_JSON = "design-spec.json";
export const DESIGN_HANDOFF_MD = "design-handoff.md";
const MOCK_PEN = "mock.pen";

type PenNode = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  width?: unknown;
  height?: unknown;
  reusable?: unknown;
  children?: unknown;
};

type PenDocument = {
  version?: unknown;
  children: PenNode[];
  variables?: Record<string, unknown>;
  [key: string]: unknown;
};

export interface DesignHandoff {
  specJson: string;
  handoffMarkdown: string;
}

function assertPenNodes(nodes: unknown[], parentPath: string): asserts nodes is PenNode[] {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    const nodePath = `${parentPath}[${index}]`;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      throw new Error(`mock.pen の ${nodePath} がノードオブジェクトではありません。`);
    }
    const children = (node as { children?: unknown }).children;
    if (children !== undefined) {
      if (!Array.isArray(children)) {
        throw new Error(`mock.pen の ${nodePath}.children が配列ではありません。`);
      }
      assertPenNodes(children, `${nodePath}.children`);
    }
  }
}

function parsePenDocument(raw: string): PenDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `mock.pen をJSONとして解析できません: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !Array.isArray((parsed as { children?: unknown }).children)
  ) {
    throw new Error("mock.pen の children が配列ではありません。");
  }
  assertPenNodes((parsed as { children: unknown[] }).children, "children");
  return parsed as PenDocument;
}

function text(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function dimension(value: unknown): string {
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "auto";
}

function markdownCell(value: unknown): string {
  const rendered =
    typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? String(value)
      : JSON.stringify(value);
  return (rendered ?? "").replaceAll("|", "\\|").replaceAll("\n", " ");
}

function collectReusable(nodes: PenNode[], result: PenNode[] = []): PenNode[] {
  for (const node of nodes) {
    if (node.reusable === true) result.push(node);
    if (Array.isArray(node.children)) collectReusable(node.children as PenNode[], result);
  }
  return result;
}

function variableRows(variables: Record<string, unknown>): string[] {
  return Object.entries(variables).map(([name, definition]) => {
    if (definition && typeof definition === "object") {
      const record = definition as { type?: unknown; value?: unknown };
      return `| ${markdownCell(name)} | ${markdownCell(record.type ?? "")} | ${markdownCell(record.value ?? definition)} |`;
    }
    return `| ${markdownCell(name)} |  | ${markdownCell(definition)} |`;
  });
}

export function buildDesignHandoff(rawPen: string): DesignHandoff {
  const document = parsePenDocument(rawPen);
  const variables =
    document.variables && typeof document.variables === "object" ? document.variables : {};
  const reusable = collectReusable(document.children);

  const screens = document.children
    .filter((node) => node.type === "frame" && node.reusable !== true)
    .map((node) => {
      const name = text(node.name, text(node.id, "名称未設定"));
      const type = text(node.type, "node");
      return `- **${name}** (${type}, ${dimension(node.width)} × ${dimension(node.height)})`;
    });
  const components = reusable.map((node) => {
    const name = text(node.name, text(node.id, "名称未設定"));
    return `- **${name}** (${text(node.type, "node")}, id: \`${text(node.id, "なし")}\`)`;
  });

  const handoffMarkdown = [
    "# Pencil デザインハンドオフ",
    "",
    "## 実装時の優先順位",
    "",
    "1. このファイルで画面・トークン・コンポーネントの概要を把握する",
    "2. 正確な寸法・余白・階層・スタイル値は `design-spec.json` を正とする",
    "3. 見た目・視覚的なバランス・全体構成は `design-mock.png` を正とする",
    "4. `03-design-system.md` と矛盾する場合、デザインに関しては本ハンドオフ成果物を優先する",
    "",
    "## 画面",
    "",
    ...(screens.length ? screens : ["- トップレベル画面なし"]),
    "",
    "## デザイントークン (Pencil variables)",
    "",
    "| 名前 | 型 | 値 |",
    "|---|---|---|",
    ...variableRows(variables),
    ...(Object.keys(variables).length ? [] : ["| (未定義) |  |  |"]),
    "",
    "## 再利用コンポーネント",
    "",
    ...(components.length ? components : ["- reusable component なし"]),
    "",
    "## `design-spec.json` の読み方",
    "",
    "- `children`: 画面と要素の完全な階層",
    "- `layout`, `gap`, `padding`, `justifyContent`, `alignItems`: レイアウト仕様",
    "- `width`, `height`, `x`, `y`: 寸法と位置",
    "- `fill`, `stroke`, `cornerRadius`: 色・境界・角丸",
    "- `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`: タイポグラフィ",
    "- `$...` の値はルートの `variables` を参照する",
    "",
    `Pencil format version: ${markdownCell(document.version ?? "不明")}`,
    "",
  ].join("\n");

  return {
    // 全プロパティを落とさず保持する。整形だけを正規化する。
    specJson: `${JSON.stringify(document, null, 2)}\n`,
    handoffMarkdown,
  };
}

/** design/mock.pen から永続ハンドオフ成果物を生成（既存モックのバックフィルにも使用） */
export async function writeDesignHandoff(designDirectory: string): Promise<DesignHandoff> {
  const raw = await fs.readFile(path.join(designDirectory, MOCK_PEN), "utf8");
  const result = buildDesignHandoff(raw);
  await Promise.all([
    fs.writeFile(path.join(designDirectory, DESIGN_SPEC_JSON), result.specJson, "utf8"),
    fs.writeFile(path.join(designDirectory, DESIGN_HANDOFF_MD), result.handoffMarkdown, "utf8"),
  ]);
  return result;
}
