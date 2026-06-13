"use client";

import { useEffect, useState } from "react";
import type { Settings } from "@/lib/store/types";

const PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "google", label: "Google (Gemini)" },
  { id: "ollama", label: "Ollama(ローカル)" },
  { id: "openrouter", label: "OpenRouter" },
] as const;

const inputCls =
  "w-full rounded-lg border border-amber-900/60 bg-black/30 p-3 text-amber-50";

export default function SettingsPage() {
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
      <main className="p-6 text-red-400">
        設定の読み込みに失敗しました。ページを再読み込みしてください。
      </main>
    );
  }
  if (!settings) {
    return <main className="p-6 text-amber-300">読み込み中...</main>;
  }
  const s = settings;

  async function save() {
    setBusy(true);
    setStatus(null);
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
    <main className="mx-auto max-w-xl p-6">
      <h1 className="mb-2 text-2xl font-bold text-amber-100">設定</h1>
      <p className="mb-6 text-sm text-amber-200/70">
        APIキーはこのPCの data/settings.json にのみ保存され、プロバイダAPI以外に送信されません。
      </p>
      <div className="space-y-5">
        <div>
          <label htmlFor="provider" className="mb-1 block font-bold text-amber-200">
            プロバイダ
          </label>
          <select
            id="provider"
            value={s.provider}
            onChange={(e) =>
              setSettings({ ...s, provider: e.target.value as Settings["provider"] })
            }
            className={inputCls}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        {s.provider !== "ollama" && (
          <div>
            <label htmlFor="apiKey" className="mb-1 block font-bold text-amber-200">
              APIキー
            </label>
            <input
              id="apiKey"
              type="password"
              autoComplete="off"
              value={s.apiKey}
              onChange={(e) => setSettings({ ...s, apiKey: e.target.value })}
              className={inputCls}
            />
          </div>
        )}
        {s.provider === "ollama" && (
          <div>
            <label htmlFor="baseUrl" className="mb-1 block font-bold text-amber-200">
              ベースURL
            </label>
            <input
              id="baseUrl"
              value={s.baseUrl}
              onChange={(e) => setSettings({ ...s, baseUrl: e.target.value })}
              placeholder="http://localhost:11434/v1"
              className={inputCls}
            />
          </div>
        )}
        <div>
          <label htmlFor="model" className="mb-1 block font-bold text-amber-200">
            モデル名
          </label>
          <input
            id="model"
            value={s.model}
            onChange={(e) => setSettings({ ...s, model: e.target.value })}
            placeholder="例: gpt-5.3 / gemini-2.5-pro / llama3"
            className={inputCls}
          />
        </div>
        <h2 className="mt-8 text-lg font-bold text-amber-100">ビルドエンジン(Cursor)</h2>
        <p className="mt-1 text-sm text-amber-200/70">
          タップ工程(コード生成)で使う Cursor SDK の設定です。ビルドを使わない場合は未設定で構いません。
        </p>
        <div className="mt-3">
          <label htmlFor="cursorApiKey" className="mb-1 block font-bold text-amber-200">
            Cursor APIキー
          </label>
          <input
            id="cursorApiKey"
            type="password"
            autoComplete="off"
            value={s.cursorApiKey}
            onChange={(e) => setSettings({ ...s, cursorApiKey: e.target.value })}
            placeholder="cursor_..."
            className={inputCls}
          />
          <p className="text-xs text-amber-200/60">空の場合は環境変数 CURSOR_API_KEY を使います。</p>
        </div>
        <div className="mt-3">
          <label htmlFor="cursorModel" className="mb-1 block font-bold text-amber-200">
            ビルドモデル名
          </label>
          <input
            id="cursorModel"
            type="text"
            value={s.cursorModel}
            onChange={(e) => setSettings({ ...s, cursorModel: e.target.value })}
            placeholder="composer-2.5"
            className={inputCls}
          />
        </div>
        <div className="flex gap-3">
          <button
            onClick={save}
            disabled={busy}
            className="rounded-lg bg-amber-600 px-6 py-3 font-bold text-stone-950 hover:bg-amber-500 disabled:opacity-50"
          >
            保存
          </button>
          <button
            onClick={testConnection}
            disabled={busy}
            className="rounded-lg border border-amber-600 px-6 py-3 font-bold text-amber-300 hover:bg-amber-900/40 disabled:opacity-50"
          >
            接続テスト
          </button>
        </div>
        {status && (
          <p aria-live="polite" className={status.isError ? "text-red-400" : "text-amber-200"}>
            {status.text}
          </p>
        )}
      </div>
    </main>
  );
}
