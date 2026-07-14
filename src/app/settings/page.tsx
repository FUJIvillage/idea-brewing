"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Settings } from "@/lib/store/types";
import { usePs1Prefs } from "@/components/ps1/ps1-prefs";
import { blip, confirmSound, offSound } from "@/components/ps1/sound";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
  { id: "ollama", label: "Ollama(ローカル)" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

export default function SettingsPage() {
  const { crtOn, setCrtOn, soundOn, toggleSound } = usePs1Prefs();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [status, setStatus] = useState<{ text: string; isError: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/settings")
      .then((r) => r.json())
      .then(setSettings)
      .catch(() => setLoadError(true));
  }, []);

  if (loadError) {
    return (
      <main className="ps-fade-in mx-auto max-w-[680px] p-6 pb-[90px] text-[#ff8a8a]">
        設定の読み込みに失敗しました。ページを再読み込みしてください。
      </main>
    );
  }
  if (!settings) {
    return (
      <main className="ps-fade-in mx-auto max-w-[680px] p-6 pb-[90px] text-[#e0a83c]">
        読み込み中...
      </main>
    );
  }
  const s = settings;

  async function save() {
    setBusy(true);
    setStatus(null);
    confirmSound();
    try {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      if (res.ok) {
        setStatus({ text: "保存しました。", isError: false });
      } else {
        const json = await res.json().catch(() => null);
        setStatus({
          text: json?.error
            ? `保存に失敗しました: ${json.error}`
            : "保存に失敗しました。",
          isError: true,
        });
      }
    } catch (err) {
      setStatus({
        text: `保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setBusy(true);
    setStatus({ text: "接続テスト中...", isError: false });
    confirmSound();
    try {
      const res = await fetch("/api/settings/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(s),
      });
      const json = await res.json();
      setStatus(
        json.ok
          ? { text: `接続OK: ${json.reply}`, isError: false }
          : { text: `接続失敗: ${json.error}`, isError: true },
      );
    } catch (err) {
      setStatus({
        text: `接続失敗: ${err instanceof Error ? err.message : String(err)}`,
        isError: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="ps-page max-w-[680px]">
      <Link href="/" className="ps-btn-ghost mb-4 inline-block">
        ◀ タンク一覧
      </Link>
      <div className="text-[13px] tracking-[4px]" style={{ color: "rgba(255,220,160,.5)" }}>
        OPTION
      </div>
      <h1 className="ps-chromatic mb-2 mt-0.5 text-[24px] font-normal tracking-[3px] text-[#ffe9c0]">
        ◆ 設定
      </h1>
      <p
        className="mb-5 text-[13px] leading-[1.7]"
        style={{ color: "rgba(255,220,160,.55)" }}
      >
        APIキーはこのPCの data/settings.json にのみ保存され、プロバイダAPI以外に送信されません。
      </p>

      <div className="ps-panel flex flex-col gap-[18px] p-[22px]">
        <div>
          <div className="ps-label">▸ プロバイダ</div>
          <div className="flex flex-col gap-1.5">
            {PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="ps-select-item"
                data-active={s.provider === p.id ? "true" : "false"}
                onClick={() => {
                  blip(560);
                  setSettings({ ...s, provider: p.id });
                  setStatus(null);
                }}
              >
                {s.provider === p.id ? "▶ " : "・ "}
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {s.provider !== "ollama" ? (
          <div>
            <label htmlFor="apiKey" className="ps-label">
              ▸ APIキー
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              value={s.apiKey}
              onChange={(e) => setSettings({ ...s, apiKey: e.target.value })}
              className="ps-input"
            />
          </div>
        ) : (
          <div>
            <label htmlFor="baseUrl" className="ps-label">
              ▸ ベースURL
            </label>
            <input
              id="baseUrl"
              value={s.baseUrl}
              onChange={(e) => setSettings({ ...s, baseUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className="ps-input"
            />
          </div>
        )}

        <div>
          <label htmlFor="model" className="ps-label">
            ▸ モデル名
          </label>
          <input
            id="model"
            value={s.model}
            onChange={(e) => setSettings({ ...s, model: e.target.value })}
            placeholder="例: gpt-5.3 / gemini-2.5-pro / llama3"
            className="ps-input"
          />
        </div>

        <div>
          <label htmlFor="effort" className="ps-label">
            ▸ Effort
          </label>
          <select
            id="effort"
            value={s.effort}
            onChange={(e) => setSettings({ ...s, effort: e.target.value })}
            className="ps-input"
          >
            <option value="">未指定(モデル既定)</option>
            <option value="none">none</option>
            <option value="minimal">minimal</option>
            <option value="low">low</option>
            <option value="medium">medium</option>
            <option value="high">high</option>
            <option value="xhigh">xhigh</option>
            <option value="max">max</option>
          </select>
          <p className="mt-1 text-[12px]" style={{ color: "rgba(255,220,160,.4)" }}>
            OpenAI / OpenRouter は reasoningEffort、Google は thinkingLevel に渡します(max/xhigh は high)。
          </p>
        </div>

        <div>
          <label htmlFor="boilMaxQuestions" className="ps-label">
            ▸ 煮沸の質問上限
          </label>
          <input
            id="boilMaxQuestions"
            type="number"
            min={1}
            max={100}
            value={s.boilMaxQuestions}
            onChange={(e) =>
              setSettings({
                ...s,
                boilMaxQuestions: Number(e.target.value),
              })
            }
            className="ps-input"
          />
          <p className="mt-1 text-[12px]" style={{ color: "rgba(255,220,160,.4)" }}>
            1〜100。達すると煮沸を自動完了します(既定: 20)。
          </p>
        </div>

        <div className="border-t-2 border-[#3a2a12] pt-4">
          <h2 className="m-0 text-[17px] font-normal tracking-[2px] text-[#f5b94a]">
            ◆ ビルドエンジン(Cursor)
          </h2>
          <p className="mt-1 text-[13px]" style={{ color: "rgba(255,220,160,.55)" }}>
            タップ工程(コード生成)で使う Cursor SDK の設定です。ビルドを使わない場合は未設定で構いません。
          </p>
          <div className="mt-3">
            <label htmlFor="cursorApiKey" className="ps-label">
              ▸ Cursor APIキー
            </label>
            <input
              id="cursorApiKey"
              type="password"
              autoComplete="off"
              value={s.cursorApiKey}
              onChange={(e) => setSettings({ ...s, cursorApiKey: e.target.value })}
              placeholder="cursor_..."
              className="ps-input"
            />
            <p className="mt-1 text-[12px]" style={{ color: "rgba(255,220,160,.4)" }}>
              空の場合は環境変数 CURSOR_API_KEY を使います。
            </p>
          </div>
          <div className="mt-3">
            <label htmlFor="cursorModel" className="ps-label">
              ▸ ビルドモデル名
            </label>
            <input
              id="cursorModel"
              type="text"
              value={s.cursorModel}
              onChange={(e) => setSettings({ ...s, cursorModel: e.target.value })}
              placeholder="composer-2.5"
              className="ps-input"
            />
          </div>
          <div className="mt-3">
            <label htmlFor="cursorEffort" className="ps-label">
              ▸ Effort
            </label>
            <select
              id="cursorEffort"
              value={s.cursorEffort}
              onChange={(e) => setSettings({ ...s, cursorEffort: e.target.value })}
              className="ps-input"
            >
              <option value="">未指定(モデル既定)</option>
              <option value="low">low</option>
              <option value="medium">medium</option>
              <option value="high">high</option>
              <option value="xhigh">xhigh</option>
              <option value="max">max</option>
            </select>
            <p className="mt-1 text-[12px]" style={{ color: "rgba(255,220,160,.4)" }}>
              例: gpt-5.6-luna で max を選ぶと params に effort=max を渡します。
            </p>
          </div>
          <div className="mt-3">
            <label htmlFor="cursorFast" className="ps-label">
              ▸ Fast
            </label>
            <select
              id="cursorFast"
              value={s.cursorFast}
              onChange={(e) => setSettings({ ...s, cursorFast: e.target.value })}
              className="ps-input"
            >
              <option value="">未指定(モデル既定)</option>
              <option value="true">on (true)</option>
              <option value="false">off (false)</option>
            </select>
            <p className="mt-1 text-[12px]" style={{ color: "rgba(255,220,160,.4)" }}>
              Cursor SDK の params に fast=true/false を渡します。
            </p>
          </div>
        </div>

        <div className="border-t-2 border-[#3a2a12] pt-4">
          <h2 className="m-0 mb-3 text-[17px] font-normal tracking-[2px] text-[#f5b94a]">
            ◆ 画面演出
          </h2>
          <div className="flex flex-col gap-1.5">
            <button
              type="button"
              className="ps-select-item"
              data-active={crtOn ? "true" : "false"}
              onClick={() => {
                blip(crtOn ? 320 : 560);
                setCrtOn(!crtOn);
              }}
            >
              {crtOn ? "▶ " : "・ "}
              CRTオーバーレイ {crtOn ? "ON" : "OFF"}
            </button>
            <button
              type="button"
              className="ps-select-item"
              data-active={soundOn ? "true" : "false"}
              onClick={() => {
                const next = !soundOn;
                toggleSound();
                if (next) setTimeout(() => blip(660), 0);
                else offSound();
              }}
            >
              {soundOn ? "▶ " : "・ "}
              効果音 {soundOn ? "ON" : "OFF"}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t-2 border-[#3a2a12] pt-4">
          <button onClick={save} disabled={busy} className="ps-btn text-[16px]">
            保存
          </button>
          <button onClick={testConnection} disabled={busy} className="ps-btn-secondary text-[16px]">
            接続テスト
          </button>
          {status && (
            <span
              aria-live="polite"
              className={status.isError ? "text-[#ff8a8a]" : "text-[#8adc8a]"}
              style={{ fontSize: 14, animation: "psFadeIn .3s steps(3)" }}
            >
              {status.text}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
