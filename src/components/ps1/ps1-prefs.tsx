"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setSoundMuted } from "./sound";

type Ps1Prefs = {
  soundOn: boolean;
  crtOn: boolean;
  bootDone: boolean;
  toggleSound: () => void;
  setCrtOn: (on: boolean) => void;
  dismissBoot: () => void;
};

const Ctx = createContext<Ps1Prefs | null>(null);

const SOUND_KEY = "idea-brewing-ps1-sound";
const CRT_KEY = "idea-brewing-ps1-crt";
const BOOT_KEY = "idea-brewing-ps1-boot";

function readBool(key: string, fallback: boolean): boolean {
  if (typeof window === "undefined") return fallback;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

export function Ps1PrefsProvider({ children }: { children: ReactNode }) {
  const [soundOn, setSoundOn] = useState(true);
  const [crtOn, setCrtOnState] = useState(true);
  const [bootDone, setBootDone] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const sound = readBool(SOUND_KEY, true);
    const crt = readBool(CRT_KEY, true);
    const boot = sessionStorage.getItem(BOOT_KEY) === "1";
    setSoundOn(sound);
    setCrtOnState(crt);
    setBootDone(boot);
    setSoundMuted(!sound);
    setReady(true);
  }, []);

  const toggleSound = useCallback(() => {
    setSoundOn((prev) => {
      const next = !prev;
      localStorage.setItem(SOUND_KEY, next ? "1" : "0");
      setSoundMuted(!next);
      return next;
    });
  }, []);

  const setCrtOn = useCallback((on: boolean) => {
    setCrtOnState(on);
    localStorage.setItem(CRT_KEY, on ? "1" : "0");
  }, []);

  const dismissBoot = useCallback(() => {
    sessionStorage.setItem(BOOT_KEY, "1");
    setBootDone(true);
  }, []);

  const value = useMemo(
    () => ({ soundOn, crtOn, bootDone: !ready || bootDone, toggleSound, setCrtOn, dismissBoot }),
    [soundOn, crtOn, bootDone, ready, toggleSound, setCrtOn, dismissBoot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePs1Prefs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePs1Prefs must be used within Ps1PrefsProvider");
  return ctx;
}
