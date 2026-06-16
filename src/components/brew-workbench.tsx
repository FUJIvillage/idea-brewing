"use client";

import { useCallback, useState } from "react";
import type { Brew } from "@/lib/store/types";
import { IngredientsPanel } from "./ingredients-panel";
import { SheetPanel } from "./sheet-panel";
import { GrillPanel } from "./grill-panel";
import { RecipePanel } from "./recipe-panel";
import { TapPanel } from "./tap-panel";

const TABS = [
  { id: "ingredients", label: "原料" },
  { id: "sheet", label: "ブリューシート" },
  { id: "grill", label: "グリル" },
  { id: "recipe", label: "レシピ" },
  { id: "tap", label: "タップ" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function BrewWorkbench({ initial }: { initial: Brew }) {
  const [brew, setBrew] = useState(initial);
  const [tab, setTab] = useState<TabId>(initial.sheet ? "sheet" : "ingredients");
  // 長時間処理(レシピ生成・グリルauto)中はタブ切替を禁止し、パネルのアンマウントを防ぐ
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/brews/${initial.id}`);
    if (res.ok) setBrew(await res.json());
  }, [initial.id]);

  const enabled: Record<TabId, boolean> = {
    ingredients: true,
    sheet: brew.sheet !== null,
    grill: brew.sheet !== null,
    recipe: brew.grill.finished,
    tap: brew.recipeGeneratedAt !== null,
  };
  const tabsBusy = busy || brew.buildProgress !== null;

  return (
    <main className="mx-auto max-w-4xl p-6">
      <h1 className="text-2xl font-bold text-amber-100">{brew.name}</h1>
      <nav className="mt-4 flex gap-2 border-b border-amber-900/60">
        {TABS.map((t) => (
          <button
            key={t.id}
            disabled={!enabled[t.id] || tabsBusy}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 font-bold ${
              tab === t.id
                ? "border-b-2 border-amber-400 text-amber-300"
                : "text-amber-200/70"
            } disabled:opacity-30`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="mt-6">
        {tab === "ingredients" && (
          <IngredientsPanel
            brew={brew}
            onUpdate={setBrew}
            onMashed={() => setTab("sheet")}
            onBusyChange={setBusy}
          />
        )}
        {tab === "sheet" && <SheetPanel brew={brew} onUpdate={setBrew} />}
        {tab === "grill" && (
          <GrillPanel brew={brew} onUpdate={setBrew} onBusyChange={setBusy} />
        )}
        {tab === "recipe" && (
          <RecipePanel
            brew={brew}
            onUpdate={setBrew}
            refresh={refresh}
            onBusyChange={setBusy}
          />
        )}
        {tab === "tap" && (
          <TapPanel
            brew={brew}
            onUpdate={setBrew}
            refresh={refresh}
            onBusyChange={setBusy}
          />
        )}
      </div>
    </main>
  );
}
