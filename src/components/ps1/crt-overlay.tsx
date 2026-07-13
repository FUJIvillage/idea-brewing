"use client";

import { usePs1Prefs } from "./ps1-prefs";

export function CrtOverlay() {
  const { crtOn } = usePs1Prefs();
  if (!crtOn) return null;
  return (
    <div className="ps-crt" aria-hidden>
      <div className="ps-crt-scan" />
      <div className="ps-crt-vignette" />
      <div className="ps-crt-flicker" />
      <div className="ps-crt-sweep" />
    </div>
  );
}
