"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
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

// ストレージを唯一の置き場にして useSyncExternalStore で購読する。
// (マウント後の effect で setState する初期化は、SSR初期値→実値のカスケード再レンダーになるため)
// サーバースナップショットは従来のSSR初期値と同じ true(起動画面はハイドレーション後に判定)
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readBool(key: string, fallback: boolean): boolean {
  const raw = window.localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === "1";
}

export function Ps1PrefsProvider({ children }: { children: ReactNode }) {
  const soundOn = useSyncExternalStore(
    subscribe,
    () => readBool(SOUND_KEY, true),
    () => true,
  );
  const crtOn = useSyncExternalStore(
    subscribe,
    () => readBool(CRT_KEY, true),
    () => true,
  );
  const bootDone = useSyncExternalStore(
    subscribe,
    () => window.sessionStorage.getItem(BOOT_KEY) === "1",
    () => true,
  );

  // サウンドモジュール(外部システム)のミュート状態を購読値に同期する
  useEffect(() => {
    setSoundMuted(!soundOn);
  }, [soundOn]);

  const toggleSound = useCallback(() => {
    localStorage.setItem(SOUND_KEY, readBool(SOUND_KEY, true) ? "0" : "1");
    emit();
  }, []);

  const setCrtOn = useCallback((on: boolean) => {
    localStorage.setItem(CRT_KEY, on ? "1" : "0");
    emit();
  }, []);

  const dismissBoot = useCallback(() => {
    sessionStorage.setItem(BOOT_KEY, "1");
    emit();
  }, []);

  const value = useMemo(
    () => ({ soundOn, crtOn, bootDone, toggleSound, setCrtOn, dismissBoot }),
    [soundOn, crtOn, bootDone, toggleSound, setCrtOn, dismissBoot],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePs1Prefs() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("usePs1Prefs must be used within Ps1PrefsProvider");
  return ctx;
}
