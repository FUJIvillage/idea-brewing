"use client";

import { usePs1Prefs } from "./ps1-prefs";

export function CrtOverlay() {
  const { crtOn } = usePs1Prefs();
  if (!crtOn) return null;
  return (
    <>
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 95,
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,.24) 0px, rgba(0,0,0,.24) 1px, transparent 1px, transparent 3px)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 96,
          background:
            "radial-gradient(ellipse at center, transparent 52%, rgba(0,0,0,.42) 100%)",
        }}
      />
      <div
        aria-hidden
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 97,
          background: "#ffe6b4",
          animation: "psFlicker 3.6s steps(2) infinite",
        }}
      />
      <div
        aria-hidden
        className="ps-crt-sweep"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          height: 70,
          pointerEvents: "none",
          zIndex: 98,
        }}
      />
    </>
  );
}
