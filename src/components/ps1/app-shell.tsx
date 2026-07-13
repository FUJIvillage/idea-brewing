"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { BootScreen } from "./boot-screen";
import { CrtOverlay } from "./crt-overlay";
import { usePs1Prefs } from "./ps1-prefs";
import { blip, confirmSound, offSound } from "./sound";

export function AppShell({ children }: { children: ReactNode }) {
  const { soundOn, bootDone, toggleSound } = usePs1Prefs();
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
    <div
      className="flex min-h-screen flex-col"
      style={{
        background:
          "repeating-conic-gradient(#070402 0% 25%, #0a0603 0% 50%) 0 0 / 4px 4px",
      }}
    >
      <header
        className="relative z-10 flex items-center justify-between gap-4"
        style={{
          padding: "10px 22px",
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
            className="ps-chromatic-logo"
            style={{ fontSize: 22, letterSpacing: 3, color: "#f5a623" }}
          >
            IDEA BREWING
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,220,160,.5)" }}>
            ver 1.0 — ローカル醸造所
          </span>
        </button>
        <nav className="flex items-center gap-2">
          <Link href="/" className="ps-nav-link" onClick={() => confirmSound()}>
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
            style={{
              cursor: "pointer",
              fontFamily: "inherit",
              fontSize: 13,
              background: "#190f06",
              border: "2px solid #6b4e1e",
              color: "#c9a15c",
              padding: "6px 10px",
              letterSpacing: 1,
            }}
            className="hover:border-[#f5b94a]"
          >
            ♪ {soundOn ? "ON" : "OFF"}
          </button>
        </nav>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>

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
        <span style={{ color: "rgba(255,220,160,.45)" }}>
          L1 / R1(Q / E キー)… タブきりかえ
        </span>
      </footer>
      <CrtOverlay />
    </div>
  );
}
