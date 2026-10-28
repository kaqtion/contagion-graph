"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type NewsItem = { title: string; url: string; domain: string; seen: string };

export default function HeadlineBar({
  initial, busy, onSubmit,
}: {
  initial?: string;
  busy: boolean;
  onSubmit: (headline: string) => void;
}) {
  const [text, setText] = useState(initial ?? "");
  const [newsOpen, setNewsOpen] = useState(false);
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => setText(initial ?? ""), [initial]);

  useEffect(() => {
    if (!newsOpen || news) return;
    api<NewsItem[]>("/news").then(setNews).catch(() => setNews([]));
  }, [newsOpen, news]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setNewsOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const submit = () => {
    const h = text.trim();
    if (h.length >= 8 && !busy) onSubmit(h);
  };

  return (
    <div ref={wrap} className="relative">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex items-stretch gap-2"
      >
        <div className="flex-1 flex items-center bg-panel border border-line-strong rounded-lg focus-within:border-origin/60 transition-colors">
          <span className="pl-3 text-faint text-[13px] select-none" aria-hidden>
            ⌁
          </span>
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={600}
            placeholder="Paste a headline, e.g. “Fire halts Renesas automotive chip plant in Japan”"
            className="flex-1 bg-transparent px-2.5 py-2.5 text-[14px] outline-none placeholder:text-faint min-w-0"
            aria-label="News headline"
          />
          <button
            type="button"
            onClick={() => setNewsOpen((o) => !o)}
            className="hidden sm:block mr-1.5 px-2 py-1 rounded text-[12px] text-muted hover:text-text hover:bg-raise"
          >
            Live news ▾
          </button>
        </div>
        <button
          type="submit"
          disabled={busy || text.trim().length < 8}
          className="px-4 rounded-lg bg-origin text-[#1a1406] font-semibold text-[13.5px] disabled:opacity-40 disabled:cursor-not-allowed hover:brightness-110 transition"
        >
          {busy ? "Tracing…" : "Trace"}
        </button>
      </form>
      {newsOpen && (
        <div className="absolute z-40 left-0 right-0 sm:right-24 mt-1.5 bg-panel border border-line-strong rounded-lg shadow-2xl max-h-[60vh] overflow-y-auto fade-up">
          <div className="px-3 py-2 text-[11px] text-faint border-b border-line flex justify-between">
            <span>Recent supply-chain headlines (GDELT, last 48h)</span>
            <span>click to use</span>
          </div>
          {news === null && <div className="p-3 space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-4" />)}</div>}
          {news?.length === 0 && <p className="p-3 text-[12.5px] text-muted">News feed unavailable right now.</p>}
          {news?.map((n, i) => (
            <button
              key={i}
              onClick={() => {
                setText(n.title);
                setNewsOpen(false);
              }}
              className="block w-full text-left px-3 py-2 hover:bg-raise border-b border-line/50 last:border-0"
            >
              <span className="text-[13px] leading-5">{n.title}</span>
              <span className="block text-[11px] text-faint">{n.domain}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
