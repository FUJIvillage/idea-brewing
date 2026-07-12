"use client";

import { useEffect, useRef, useState } from "react";
import type { Brew } from "@/lib/store/types";

type ErrorBody = { error?: string };

/**
 * mature / pub パネル共通の実行系 POST・中断・busy 管理フック。
 * `/api/brews/{brewId}/{base}/...` に対する post/cancel と、
 * リモート進行中(running)の 1 秒ポーリングを一元化する。
 */
export function useBrewAction({
  brewId,
  base,
  running,
  onUpdate,
  refresh,
  onBusyChange,
}: {
  brewId: string;
  base: "mature" | "pub";
  running: boolean;
  onUpdate: (b: Brew) => void;
  refresh: () => Promise<void>;
  onBusyChange: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // リモートで処理が進行中でもポーリングして追従する
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => void refresh(), 1000);
    return () => clearInterval(timer);
  }, [running, busy, refresh]);

  /** 実行系 POST。busy 解除の直前に onSettled(成功時は更新後の Brew、失敗時は null)を呼ぶ */
  async function post(
    pathSuffix: string,
    body?: unknown,
    onSettled?: (updated: Brew | null) => void | Promise<void>,
  ): Promise<void> {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    const timer = setInterval(() => void refresh(), 1000);
    let updatedBrew: Brew | null = null;
    try {
      const res = await fetch(`/api/brews/${brewId}/${base}/${pathSuffix}`, {
        method: "POST",
        ...(body !== undefined
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      clearInterval(timer);
      const json = (await res.json()) as Brew | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      updatedBrew = json as Brew;
      onUpdate(updatedBrew);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      clearInterval(timer);
      try {
        await refresh();
      } catch {
        // refreshが失敗してもbusy解除は必ず行う(タブが永久ロックされるのを防ぐ)
      }
      await onSettled?.(updatedBrew);
      inFlightRef.current = false;
      setBusy(false);
      onBusyChange(false);
    }
  }

  async function cancel(): Promise<void> {
    setError(null);
    try {
      const res = await fetch(`/api/brews/${brewId}/${base}/cancel`, { method: "POST" });
      const json = (await res.json()) as Brew | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      if ("schemaVersion" in json) onUpdate(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      try {
        await refresh();
      } catch {
        // キャンセル後の再同期失敗は無視する
      }
    }
  }

  return { busy, error, setError, post, cancel };
}
