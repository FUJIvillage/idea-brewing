"use client";

import { confirmSound, unlockAudio } from "./sound";
import { usePs1Prefs } from "./ps1-prefs";
import { Ps1Tank } from "./ps1-tank";

export function BootScreen() {
  const { bootDone, dismissBoot } = usePs1Prefs();
  if (bootDone) return null;

  function start() {
    unlockAudio();
    confirmSound();
    dismissBoot();
  }

  return (
    <div
      role="dialog"
      aria-label="起動画面"
      onClick={start}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          start();
        }
      }}
      tabIndex={0}
      className="fixed inset-0 z-[60] flex cursor-pointer flex-col items-center justify-center"
      style={{
        background: "radial-gradient(ellipse at center, #16100a 0%, #060302 70%)",
      }}
    >
      <div
        style={{
          fontSize: 14,
          letterSpacing: 8,
          color: "rgba(255,220,160,.45)",
          marginBottom: 18,
        }}
      >
        FUJIVILLAGE ENTERTAINMENT
      </div>
      <h1
        className="ps-chromatic-strong"
        style={{
          margin: 0,
          fontSize: 56,
          fontWeight: 400,
          color: "#f5a623",
          animation: "psBootIn 1.1s steps(8) both",
        }}
      >
        IDEA BREWING
      </h1>
      <div
        style={{
          marginTop: 10,
          fontSize: 18,
          letterSpacing: 10,
          color: "rgba(255,220,160,.55)",
        }}
      >
        アイデア醸造システム
      </div>
      <div style={{ marginTop: 28, marginBottom: 8 }}>
        <Ps1Tank fill={80} size={170} speed={1.1} />
      </div>
      <div
        className="ps-blink"
        style={{ marginTop: 34, fontSize: 20, letterSpacing: 6, color: "#ffe9c0" }}
      >
        PRESS START
      </div>
      <div
        style={{
          position: "absolute",
          bottom: 28,
          fontSize: 12,
          letterSpacing: 2,
          color: "rgba(255,220,160,.35)",
        }}
      >
        © FUJIVILLAGE / LOCAL BREWERY SYSTEM
      </div>
    </div>
  );
}
