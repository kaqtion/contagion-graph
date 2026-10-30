"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type NewsItem = { title: string; url: string; domain: string; seen: string };

export default function HeadlineBar({
  initial, busy, onSubmit, hero = false,
}: {
  initial?: string;
  busy: boolean;
  onSubmit: (headline: string) => void;
  hero?: boolean;
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
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setNewsOpen(false);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
    };
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
        className={`flex items-center gap-2 transition-colors duration-200 focus-within:border-origin/50 ${
          hero ? "glass rounded-2xl p-2 pl-4" : "bg-panel border border-line-strong rounded-xl p-1.5 pl-3"
        }`}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden className="shrink-0 text-faint">
          <circle cx="8" cy="8" r="2.2" fill="var(--origin)" />
          <circle cx="8" cy="8" r="5" fill="none" stroke="currentColor" strokeWidth="1" />
          <circle cx="8" cy="8" r="7.5" fill="none" stroke="currentColor" strokeWidth="0.75" opacity="0.6" />
        </svg>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={600}
          placeholder={hero ? "Paste any headline…" : "Paste a headline, e.g. “Fire halts Renesas automotive chip plant in Japan”"}
          className={`flex-1 bg-transparent outline-none placeholder:text-faint min-w-0 ${hero ? "py-3 text-[16px]" : "py-1.5 text-[14px]"}`}
          aria-label="News headline"
        />
        <button
          type="button"
          onClick={() => setNewsOpen((o) => !o)}
          aria-expanded={newsOpen}
          className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[12.5px] transition-colors ${
            newsOpen ? "bg-white/[0.07] text-text" : "text-muted hover:text-text hover:bg-white/[0.04]"
          }`}
        >
          <span className="relative inline-flex w-1.5 h-1.5">
            <span className="absolute inset-0 rounded-full bg-hurt" style={{ animation: "pulse-ring 2s ease-out infinite" }} />
            <span className="relative w-1.5 h-1.5 rounded-full bg-hurt" />
          </span>
          Live news
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={`transition-transform duration-200 ${newsOpen ? "rotate-180" : ""}`}>
            <path d="M2 3.5 5 6.5 8 3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
          </svg>
        </button>
        <button
          type="submit"
          disabled={busy || text.trim().length < 8}
          className={`btn-primary ${hero ? "px-5 h-11 text-[14px]" : "px-4 h-9 text-[13.5px]"}`}
        >
          {busy ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-[#17120a]/30 border-t-[#17120a] animate-spin" />
              Tracing
            </>
          ) : (
            <>
              Trace
              <svg width="13" height="13" viewBox="0 0 14 14" aria-hidden>
                <path d="M2 7h9.5M7.5 3l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </>
          )}
        </button>
      </form>
      {newsOpen && (
        <div className="glass absolute z-40 left-0 right-0 mt-2 rounded-xl max-h-[60vh] overflow-y-auto fade-up">
          <div className="sticky top-0 glass !border-x-0 !border-t-0 rounded-t-xl px-4 py-2.5 flex justify-between items-center">
            <span className="eyebrow">supply-chain headlines · last 48h</span>
            <span className="text-[11px] text-faint">click one to use it</span>
          </div>
          {news === null && <div className="p-4 space-y-3">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-4" />)}</div>}
          {news?.length === 0 && <p className="p-4 text-[13px] text-muted">The news feed isn’t responding right now. Paste a headline instead.</p>}
          {news?.map((n, i) => (
            <button
              key={i}
              onClick={() => {
                setText(n.title);
                setNewsOpen(false);
              }}
              className="group flex w-full items-baseline gap-3 text-left px-4 py-2.5 hover:bg-white/[0.04] border-b border-line/60 last:border-0 transition-colors"
            >
              <span className="num text-[10.5px] text-faint w-5 shrink-0">{String(i + 1).padStart(2, "0")}</span>
              <span className="flex-1 min-w-0">
                <span className="block text-[13.5px] leading-5 group-hover:text-text text-text/90">{n.title}</span>
                <span className="block text-[11px] text-faint mt-0.5">{n.domain}</span>
              </span>
              <span className="text-faint opacity-0 group-hover:opacity-100 -translate-x-1 group-hover:translate-x-0 transition-all duration-200">→</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
