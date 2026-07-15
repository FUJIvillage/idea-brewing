import type { Brew } from "@/lib/store/types";

export type WorkbenchTab =
  | "ingredients"
  | "sheet"
  | "boil"
  | "recipe"
  | "design"
  | "tap"
  | "mature"
  | "pub";

/** 工程に応じたワークベンチ初期タブ */
export function defaultTabForBrew(brew: Brew): WorkbenchTab {
  if (brew.pubProgress !== null) return "pub";
  if (brew.maturationProgress !== null) return "mature";
  if (brew.buildProgress !== null) return "tap";
  if (brew.recipeProgress !== null) return "recipe";
  if (brew.designMock?.status === "generating") return "design";

  switch (brew.stage) {
    case "built":
      return "tap";
    case "fermenting":
    case "done":
      return "recipe";
    case "boiling":
      return "boil";
    case "ingredients":
    default:
      return "ingredients";
  }
}

export function progressPercent(stage: Brew["stage"]): number {
  switch (stage) {
    case "ingredients":
      return 20;
    case "boiling":
      return 55;
    case "fermenting":
      return 85;
    case "done":
    case "built":
      return 100;
  }
}

export function progressBlocks(pct: number): string {
  const n = Math.round(pct / 10);
  return "■".repeat(n) + "□".repeat(10 - n);
}

export function tankLabel(index: number): string {
  return `TANK-${String(index + 1).padStart(2, "0")}`;
}

export function parseTabParam(raw: string | null | undefined): WorkbenchTab | null {
  const tabs: WorkbenchTab[] = [
    "ingredients",
    "sheet",
    "boil",
    "recipe",
    "design",
    "tap",
    "mature",
    "pub",
  ];
  if (!raw) return null;
  return tabs.includes(raw as WorkbenchTab) ? (raw as WorkbenchTab) : null;
}
