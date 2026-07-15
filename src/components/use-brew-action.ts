"use client";

import { useEffect, useRef, useState } from "react";
import type { Brew } from "@/lib/store/types";
import {
  recoverLongJobFetchError,
  type BrewActionBase,
} from "@/lib/brew-action-network";

type ErrorBody = { error?: string };

/**
 * 実行系パネル(tap / mature / pub / recipe / design)共通の POST・中断・busy 管理フック。
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
  onTick,
}: {
  brewId: string;
  base: BrewActionBase;
  running: boolean;
  onUpdate: (b: Brew) => void;
  /** 可能なら最新 Brew を返す(通信切断からの回復判定に使う) */
  refresh: () => Promise<Brew | void>;
  onBusyChange: (busy: boolean) => void;
  /** ポーリング1秒ごとの追加処理(タップパネルのログ追従など)。useCallback等で安定させること */
  onTick?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // リモートで処理が進行中でもポーリングして追従する
  useEffect(() => {
    if (!running || busy) return;
    const timer = setInterval(() => {
      void refresh();
    }, 1000);
    const tickTimer = onTick
      ? setInterval(() => {
          onTick();
        }, 1000)
      : null;
    return () => {
      clearInterval(timer);
      if (tickTimer) clearInterval(tickTimer);
    };
  }, [running, busy, refresh, onTick]);

  /** 実行系 POST(pathSuffixが空ならbase自体に投げる)。busy 解除の直前に onSettled(成功時は更新後の Brew、失敗時は null)を呼ぶ */
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
    const timer = setInterval(() => {
      void refresh();
      onTick?.();
    }, 1000);
    let updatedBrew: Brew | null = null;
    let caught: unknown = null;
    try {
      const path = pathSuffix ? `${base}/${pathSuffix}` : base;
      const res = await fetch(`/api/brews/${brewId}/${path}`, {
        method: "POST",
        ...(body !== undefined
          ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
          : {}),
      });
      const json = (await res.json()) as Brew | ErrorBody;
      if (!res.ok) {
        throw new Error("error" in json && json.error ? json.error : "エラーが発生しました。");
      }
      updatedBrew = json as Brew;
      onUpdate(updatedBrew);
    } catch (err) {
      caught = err;
    } finally {
      clearInterval(timer);
      let latest: Brew | null | undefined = updatedBrew;
      try {
        latest = (await refresh()) ?? latest;
      } catch {
        // refreshが失敗してもbusy解除は必ず行う(タブが永久ロックされるのを防ぐ)
      }
      if (caught) {
        setError(recoverLongJobFetchError(caught, base, latest));
      }
      try {
        await onSettled?.(updatedBrew);
      } catch {
        // 後処理の失敗でもbusy解除は必ず行う(タブが永久ロックされるのを防ぐ)
      }
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
