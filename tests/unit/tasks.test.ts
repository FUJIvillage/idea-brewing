import { describe, expect, it } from "vitest";
import { extractTasks } from "@/lib/tap/tasks";

describe("extractTasks", () => {
  it("第2レベル見出しをタスクとして抽出する", () => {
    const md = [
      "# 実装計画",
      "",
      "前置き",
      "",
      "## タスク1: 土台",
      "本文1",
      "",
      "### 詳細",
      "詳細本文",
      "",
      "## タスク2: 画面",
      "本文2",
    ].join("\n");
    const tasks = extractTasks(md);
    expect(tasks.map((t) => t.title)).toEqual(["タスク1: 土台", "タスク2: 画面"]);
    expect(tasks[0].body).toContain("本文1");
    expect(tasks[0].body).toContain("### 詳細");
    expect(tasks[1].body).toBe("本文2");
  });

  it("見出しが無ければ空配列(一括実装フォールバック)", () => {
    expect(extractTasks("ただの文章")).toEqual([]);
    expect(extractTasks("")).toEqual([]);
  });
});
