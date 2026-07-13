"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BootScreen } from "./boot-screen";
import { CrtOverlay } from "./crt-overlay";
import { usePs1Prefs } from "./ps1-prefs";
import { blip, confirmSound, offSound } from "./sound";

export function AppShell({ children }: { children: ReactNode }) {
  const { soundOn, bootDone, toggleSound } = usePs1Prefs();
  const pathname = usePathname();
  const router = useRouter();

  if (!bootDone) {
    return (
      <>
        <BootScreen />
        <CrtOverlay />
      </>
    );
  }

  return (
    <>
      <header
        className="relative z-10 flex items-center justify-between gap-4 px-[22px] py-2.5"
        style={{
          background: "#0b0703",
          borderBottom: "2px solid #8a6428",
          boxShadow: "0 3px 0 #000",
        }}
      >
        <button
          type="button"
          onClick={() => {
            confirmSound();
            router.push("/");
          }}
          className="flex cursor-pointer items-baseline gap-2.5 border-0 bg-transparent p-0"
        >
          <span
            className="ps-chromatic"
            style={{ fontSize: 22, letterSpacing: 3, color: "#f5a623" }}
          >
            IDEA BREWING
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,220,160,.5)" }}>
            ver 1.0 — ローカル醸造所
          </span>
        </button>
        <nav className="flex items-center gap-2">
          <Link
            href="/"
            className="ps-nav-link"
            onClick={() => confirmSound()}
            data-active={pathname === "/" ? "true" : undefined}
          >
            タンク一覧
          </Link>
          <Link
            href="/leaderboard"
            className="ps-nav-link"
            onClick={() => confirmSound()}
          >
            リーダーボード
          </Link>
          <Link href="/settings" className="ps-nav-link" onClick={() => confirmSound()}>
            設定
          </Link>
          <button
            type="button"
            onClick={() => {
              const next = !soundOn;
              toggleSound();
              if (next) setTimeout(() => blip(660), 0);
              else offSound();
            }}
            className="cursor-pointer border-2 border-[#6b4e1e] bg-[#190f06] px-2.5 py-1.5 font-[inherit] text-[13px] tracking-wide text-[#c9a15c] hover:border-[#f5b94a]"
          >
            ♪ {soundOn ? "ON" : "OFF"}
          </button>
        </nav>
      </header>

      <div className="flex min-h-[calc(100vh-48px)] flex-col">{children}</div>

      <footer className="ps-footer-hint">
        <span>
          <span style={{ color: "#ff6a7a" }}>○</span> けってい
        </span>
        <span>
          <span style={{ color: "#7ab8ff" }}>✕</span> もどる
        </span>
        <span>
          <span style={{ color: "#8adc8a" }}>△</span> くわしく
        </span>
        <span>L1・R1(Q/Eキー)…タブきりかえ</span>
      </footer>
      <CrtOverlay />
    </>
  );
}
