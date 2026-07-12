"use client";

import { useCallback, useState } from "react";
import type { Brew } from "@/lib/store/types";
import { IngredientsPanel } from "./ingredients-panel";
import { SheetPanel } from "./sheet-panel";
import { GrillPanel } from "./grill-panel";
import { RecipePanel } from "./recipe-panel";
import { TapPanel } from "./tap-panel";
import { MaturePanel } from "./mature-panel";
import { PubPanel } from "./pub-panel";

const TABS = [
  { id: "ingredients", label: "原料" },
  { id: "sheet", label: "ブリューシート" },
  { id: "grill", label: "グリル" },
  { id: "recipe", label: "レシピ" },
  { id: "tap", label: "タップ" },
  { id: "mature", label: "熟成" },
  { id: "pub", label: "Pub" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function BrewWorkbench({ initial }: { initial: Brew }) {
  const [brew, setBrew] = useState(initial);
  const [tab, setTab] = useState<TabId>(
    initial.pubProgress !== null
      ? "pub"
      : initial.maturationProgress !== null
        ? "mature"
        : initial.buildProgress !== null
          ? "tap"
          : initial.recipeProgress !== null
            ? "recipe"
            : initial.sheet
              ? "sheet"
              : "ingredients",
  );
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
    mature: brew.batches.some((b) => b.status === "succeeded"),
    pub: brew.batches.some((b) => b.status === "succeeded"),
  };
  const tabsBusy =
    busy ||
    brew.recipeProgress !== null ||
    brew.buildProgress !== null ||
    brew.maturationProgress !== null ||
    brew.pubProgress !== null;
  const visibleTab: TabId =
    brew.pubProgress !== null
      ? "pub"
      : brew.maturationProgress !== null
        ? "mature"
        : brew.buildProgress !== null
          ? "tap"
          : brew.recipeProgress !== null
            ? "recipe"
            : tab;

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
              visibleTab === t.id
                ? "border-b-2 border-amber-400 text-amber-300"
                : "text-amber-200/70"
            } disabled:opacity-30`}
          >
            {t.label}
          </button>
        ))}
      </nav>
      <div className="mt-6">
        {visibleTab === "ingredients" && (
          <IngredientsPanel
            brew={brew}
            onUpdate={setBrew}
            onMashed={() => setTab("sheet")}
            onBusyChange={setBusy}
          />
        )}
        {visibleTab === "sheet" && <SheetPanel brew={brew} onUpdate={setBrew} />}
        {visibleTab === "grill" && (
          <GrillPanel brew={brew} onUpdate={setBrew} onBusyChange={setBusy} />
        )}
        {visibleTab === "recipe" && (
          <RecipePanel
            brew={brew}
            onUpdate={setBrew}
            refresh={refresh}
            onBusyChange={setBusy}
          />
        )}
        {visibleTab === "tap" && (
          <TapPanel
            brew={brew}
            onUpdate={setBrew}
            refresh={refresh}
            onBusyChange={setBusy}
          />
        )}
        {visibleTab === "mature" && (
          <MaturePanel
            brew={brew}
            onUpdate={setBrew}
            refresh={refresh}
            onBusyChange={setBusy}
          />
        )}
        {visibleTab === "pub" && (
          <PubPanel
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
