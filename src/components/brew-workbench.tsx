"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Brew } from "@/lib/store/types";
import {
  defaultTabForBrew,
  type WorkbenchTab,
} from "@/components/ps1/brew-ui";
import { cursorSound } from "@/components/ps1/sound";
import { IngredientsPanel } from "./ingredients-panel";
import { SheetPanel } from "./sheet-panel";
import { GrillPanel } from "./grill-panel";
import { RecipePanel } from "./recipe-panel";
import { TapPanel } from "./tap-panel";
import { MaturePanel } from "./mature-panel";
import { PubPanel } from "./pub-panel";
import { latestSucceededBatch } from "@/lib/tap/batches";

const TABS = [
  { id: "ingredients", label: "原料" },
  { id: "sheet", label: "ブリューシート" },
  { id: "grill", label: "グリル" },
  { id: "recipe", label: "レシピ" },
  { id: "tap", label: "タップ" },
  { id: "mature", label: "熟成" },
  { id: "pub", label: "Pub" },
] as const satisfies ReadonlyArray<{ id: WorkbenchTab; label: string }>;

function statusBadge(brew: Brew): { label: string; color: string; border: string } {
  if (brew.stage === "built") {
    const latest = latestSucceededBatch(brew);
    const base = latest ? `提供中(バッチ${latest.number})` : "提供中";
    return { label: base, color: "#8adc8a", border: "#4a8a4a" };
  }
  const labels: Record<Brew["stage"], string> = {
    ingredients: "原料投入中",
    grilling: "グリル中",
    fermenting: "発酵待ち",
    done: "レシピ完成",
    built: "提供中",
  };
  return { label: labels[brew.stage], color: "#f5c96a", border: "#8a6428" };
}

export function BrewWorkbench({
  initial,
  initialTab,
}: {
  initial: Brew;
  initialTab?: WorkbenchTab | null;
}) {
  const [brew, setBrew] = useState(initial);
  const [tab, setTab] = useState<WorkbenchTab>(
    initialTab ?? defaultTabForBrew(initial),
  );
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/brews/${initial.id}`);
    if (res.ok) setBrew(await res.json());
  }, [initial.id]);

  const enabled: Record<WorkbenchTab, boolean> = {
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
  const visibleTab: WorkbenchTab =
    brew.pubProgress !== null
      ? "pub"
      : brew.maturationProgress !== null
        ? "mature"
        : brew.buildProgress !== null
          ? "tap"
          : brew.recipeProgress !== null
            ? "recipe"
            : tab;

  const enabledRef = useRef(enabled);
  const tabsBusyRef = useRef(tabsBusy);
  const visibleTabRef = useRef(visibleTab);
  enabledRef.current = enabled;
  tabsBusyRef.current = tabsBusy;
  visibleTabRef.current = visibleTab;

  const selectTab = useCallback((id: WorkbenchTab) => {
    if (!enabledRef.current[id] || tabsBusyRef.current) return;
    cursorSound();
    setTab(id);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key !== "q" && e.key !== "Q" && e.key !== "e" && e.key !== "E") return;
      e.preventDefault();
      const ids = TABS.map((t) => t.id);
      const idx = ids.indexOf(visibleTabRef.current);
      const dir = e.key === "q" || e.key === "Q" ? -1 : 1;
      for (let step = 1; step <= ids.length; step++) {
        const next = ids[(idx + dir * step + ids.length) % ids.length];
        if (enabledRef.current[next] && !tabsBusyRef.current) {
          selectTab(next);
          break;
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectTab]);

  const badge = statusBadge(brew);

  return (
    <main className="ps-fade-in mx-auto w-full max-w-[1000px] box-border px-6 pb-[90px] pt-6">
      <Link href="/" className="ps-btn-ghost mb-3.5 inline-block no-underline">
        ◀ タンク一覧
      </Link>
      <div className="flex flex-wrap items-baseline gap-3.5">
        <h1 className="ps-chromatic m-0 text-[24px] font-normal tracking-[2px] text-[#ffe9c0]">
          ◆ {brew.name}
        </h1>
        <span
          className="px-2 py-0.5 text-[13px] tracking-wide"
          style={{ border: `1px solid ${badge.border}`, color: badge.color }}
        >
          {badge.label}
        </span>
      </div>

      <nav className="mt-[18px] flex flex-wrap items-end gap-1 border-b-2 border-[#8a6428]">
        <span
          className="mb-1.5 mr-1.5 border border-[#3a2a12] px-1.5 py-0.5 text-[11px]"
          style={{ color: "rgba(255,220,160,.4)" }}
        >
          ◀L1
        </span>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            disabled={!enabled[t.id] || tabsBusy}
            onClick={() => selectTab(t.id)}
            className="ps-tab"
            data-active={visibleTab === t.id ? "true" : "false"}
          >
            {visibleTab === t.id ? `▶ ${t.label}` : t.label}
          </button>
        ))}
        <span
          className="mb-1.5 ml-1.5 border border-[#3a2a12] px-1.5 py-0.5 text-[11px]"
          style={{ color: "rgba(255,220,160,.4)" }}
        >
          R1▶
        </span>
      </nav>

      <div
        className="p-[22px]"
        style={{
          background: "#150d05",
          border: "2px solid #8a6428",
          borderTop: "none",
          boxShadow: "inset 0 0 0 2px #050302, 6px 6px 0 rgba(0,0,0,.55)",
        }}
      >
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
