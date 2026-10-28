"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Core, ElementDefinition } from "cytoscape";
import type { EdgeInfo, Exposure, NodeInfo } from "@/lib/api";
import { label } from "@/lib/format";

const RADII = [0, 165, 295, 415];
const C = {
  hurt: "#e85a38",
  help: "#3a88ee",
  origin: "#f2b544",
  neutral: "#5d6676",
  edge: "#343c4a",
  text: "#c9ced8",
  bg: "#0a0c10",
};

type Props = {
  exposures: Exposure[];
  origins: { id: string; name: string; kind: string }[];
  nodes: NodeInfo[];
  edges: EdgeInfo[];
  scores: Record<string, [number, number]>;
  selected: string | null;
  hovered: string | null;
  onSelect: (id: string | null) => void;
  maxNodes?: number;
};

type Placed = { id: string; hop: number; impact: number; parent: string | null; x: number; y: number; angle: number };

function layout(exposures: Exposure[], originIds: string[], scores: Props["scores"], maxNodes: number) {
  const shown = exposures.filter((e) => !e.is_origin).slice(0, maxNodes);
  const info = new Map<string, { hop: number; impact: number; parent: string | null }>();
  originIds.forEach((o) => info.set(o, { hop: 0, impact: scores[o]?.[0] ?? 0, parent: null }));
  // every node on the top two paths of a shown company is drawn, so each chain is visible end to end
  for (const ex of shown) {
    for (const p of ex.paths.slice(0, 2)) {
      p.nodes.forEach((n, i) => {
        if (info.has(n)) {
          const cur = info.get(n)!;
          if (i < cur.hop) info.set(n, { hop: i, impact: cur.impact, parent: i ? p.nodes[i - 1] : null });
          return;
        }
        info.set(n, { hop: i, impact: scores[n]?.[0] ?? 0, parent: i ? p.nodes[i - 1] : null });
      });
    }
  }
  const placed = new Map<string, Placed>();
  const origins = [...info.entries()].filter(([, v]) => v.hop === 0);
  origins.forEach(([id, v], i) => {
    const a = (2 * Math.PI * i) / Math.max(origins.length, 1) - Math.PI / 2;
    const r = origins.length > 1 ? 52 : 0;
    placed.set(id, { id, ...v, angle: a, x: r * Math.cos(a), y: r * Math.sin(a) });
  });
  for (let hop = 1; hop <= 3; hop++) {
    const ring = [...info.entries()].filter(([, v]) => v.hop === hop).map(([id, v]) => ({ id, ...v }));
    if (!ring.length) continue;
    let desired: { id: string; want: number; v: (typeof ring)[number] }[];
    if (hop === 1) {
      // hurt companies sweep one side of the ring, helped ones the other
      ring.sort((a, b) => a.impact - b.impact);
      desired = ring.map((v, i) => ({ id: v.id, v, want: -Math.PI / 2 + (2 * Math.PI * (i + 0.5)) / ring.length }));
    } else {
      desired = ring.map((v) => ({ id: v.id, v, want: placed.get(v.parent ?? "")?.angle ?? 0 }));
      desired.sort((a, b) => a.want - b.want);
      const gap = Math.min((2 * Math.PI) / desired.length, 0.2);
      for (let pass = 0; pass < 3; pass++) {
        for (let i = 1; i < desired.length; i++) {
          if (desired[i].want - desired[i - 1].want < gap) desired[i].want = desired[i - 1].want + gap;
        }
      }
      const spill = desired.length ? desired[desired.length - 1].want - desired[0].want : 0;
      if (spill > 2 * Math.PI - gap) {
        desired.forEach((d, i) => (d.want = desired[0].want + (2 * Math.PI * i) / desired.length));
      } else {
        // re-centre the spread on the parents' mean angle
        const shift = (desired.reduce((s, d) => s + (placed.get(d.v.parent ?? "")?.angle ?? d.want), 0) / desired.length) -
          desired.reduce((s, d) => s + d.want, 0) / desired.length;
        desired.forEach((d) => (d.want += shift));
      }
    }
    const R = RADII[hop];
    desired.forEach((d) =>
      placed.set(d.id, {
        id: d.id, hop, impact: d.v.impact, parent: d.v.parent, angle: d.want,
        x: R * Math.cos(d.want), y: R * Math.sin(d.want),
      }),
    );
  }
  return placed;
}

export default function ContagionGraph({
  exposures, origins, nodes, edges, scores, selected, hovered, onSelect, maxNodes = 36,
}: Props) {
  const box = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 1 });
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);
  const originIds = useMemo(() => origins.map((o) => o.id), [origins]);
  const placed = useMemo(() => layout(exposures, originIds, scores, maxNodes), [exposures, originIds, scores, maxNodes]);
  const maxRing = useMemo(() => Math.max(1, ...[...placed.values()].map((p) => p.hop)), [placed]);

  const elements = useMemo<ElementDefinition[]>(() => {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const maxAbs = Math.max(0.05, ...[...placed.values()].filter((p) => p.hop > 0).map((p) => Math.abs(p.impact)));
    const els: ElementDefinition[] = [];
    for (const p of placed.values()) {
      const n = byId.get(p.id);
      const isOrigin = p.hop === 0;
      const size = isOrigin ? 38 : 14 + 30 * Math.sqrt(Math.abs(p.impact) / maxAbs);
      els.push({
        group: "nodes",
        data: {
          id: p.id,
          label: n ? label(n) : p.id,
          size,
          color: isOrigin ? C.origin : p.impact < 0 ? C.hurt : p.impact > 0 ? C.help : C.neutral,
          hop: p.hop,
          shape: n && n.kind !== "company" ? "round-diamond" : "ellipse",
        },
        position: { x: p.x, y: p.y },
        classes: isOrigin ? "origin" : "",
      });
    }
    const seen = new Set<string>();
    const stepSign = new Map<number, string>();
    for (const ex of exposures)
      for (const p of ex.paths.slice(0, 2)) for (const s of p.steps) stepSign.set(s.edge_id, s.kind);
    for (const e of edges) {
      const kind = stepSign.get(e.id);
      if (!kind) continue;
      // orient the edge the way the shock travels
      const fwd = kind === "up" || kind === "located_in" || kind === "uses" || kind === "produces" ? [e.dst, e.src] : [e.src, e.dst];
      const [s, t] = kind === "competitor" ? (placed.get(e.src)?.hop === 0 ? [e.src, e.dst] : [e.dst, e.src]) : fwd;
      if (!placed.has(s) || !placed.has(t) || seen.has(`${s}>${t}`)) continue;
      seen.add(`${s}>${t}`);
      els.push({
        group: "edges",
        data: { id: `e${e.id}`, source: s, target: t, w: 0.8 + 2.4 * e.strength, kind },
        classes: [e.quality === "verified" ? "verified" : e.strength_source === "curated" ? "curated" : "stale",
          kind === "competitor" || kind === "produces" ? "benefit" : ""].join(" "),
      });
    }
    return els;
  }, [placed, nodes, edges, exposures]);

  // create once
  const fitRef = useRef(() => {});
  fitRef.current = () => {
    const cy = cyRef.current;
    if (!cy || !cy.elements().length || !box.current?.clientWidth) return;
    cy.fit(undefined, 36);
    if (cy.zoom() > 1.3) {
      cy.zoom(1.3);
      cy.center();
    }
    setView({ x: cy.pan().x, y: cy.pan().y, z: cy.zoom() });
  };

  useEffect(() => {
    let cancelled = false;
    let ro: ResizeObserver | null = null;
    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      if (cancelled || !box.current) return;
      const cy = cytoscape({
        container: box.current,
        elements: [],
        layout: { name: "preset" },
        minZoom: 0.35,
        maxZoom: 2.5,
        wheelSensitivity: 0.25,
        boxSelectionEnabled: false,
        autoungrabify: true,
        style: [
          {
            selector: "node",
            style: {
              width: "data(size)", height: "data(size)", shape: "data(shape)" as never,
              "background-color": "data(color)", "background-opacity": 0.9,
              "border-width": 1.5, "border-color": C.bg,
              label: "data(label)", color: C.text, "font-size": 10, "font-family": "JetBrains Mono, monospace",
              "text-valign": "bottom", "text-margin-y": 4, "text-outline-color": C.bg, "text-outline-width": 2.5,
              "transition-property": "opacity, border-width, border-color", "transition-duration": 180,
            },
          },
          {
            selector: "node.origin",
            style: { "border-width": 7, "border-color": "rgba(242,181,68,0.22)", "font-size": 12, "font-weight": 600, color: "#f6d79a" },
          },
          {
            selector: "edge",
            style: {
              width: "data(w)", "line-color": C.edge, "curve-style": "bezier", "target-arrow-shape": "triangle",
              "target-arrow-color": C.edge, "arrow-scale": 0.7, opacity: 0.85,
              "transition-property": "opacity, line-color, width", "transition-duration": 180,
            },
          },
          { selector: "edge.curated", style: { "line-style": "dotted" } },
          { selector: "edge.stale", style: { "line-style": "dashed" } },
          { selector: "edge.benefit", style: { "line-color": "#2b4566", "target-arrow-color": "#2b4566" } },
          { selector: ".dim", style: { opacity: 0.14 } },
          { selector: "edge.hl", style: { "line-color": "#c9ced8", "target-arrow-color": "#c9ced8", opacity: 1 } },
          { selector: "node.sel", style: { "border-width": 3, "border-color": "#ffffff" } },
        ],
      });
      cy.on("tap", "node", (e) => onSelectRef.current(e.target.id()));
      cy.on("tap", (e) => {
        if (e.target === cy) onSelectRef.current(null);
      });
      cy.on("mouseover", "node", () => box.current && (box.current.style.cursor = "pointer"));
      cy.on("mouseout", "node", () => box.current && (box.current.style.cursor = "default"));
      cy.on("viewport resize", () => setView({ x: cy.pan().x, y: cy.pan().y, z: cy.zoom() }));
      // the container can mount at zero size (drawer/grid layout); refit whenever it changes
      ro = new ResizeObserver(() => {
        cy.resize();
        fitRef.current();
      });
      ro.observe(box.current);
      cyRef.current = cy;
      setReady(true);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      cyRef.current?.destroy();
      cyRef.current = null;
    };
  }, []);

  // load elements with a ring-by-ring reveal
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    cy.elements().remove();
    cy.add(elements);
    cy.resize();
    fitRef.current();
    cy.nodes().forEach((n) => {
      n.style("opacity", 0);
      n.delay(120 + n.data("hop") * 220).animate({ style: { opacity: 1 } }, { duration: 320 });
    });
    cy.edges().forEach((e) => {
      e.style("opacity", 0);
      const hop = Math.max(e.source().data("hop"), e.target().data("hop"));
      e.delay(60 + hop * 220).animate({ style: { opacity: 0.85 } }, { duration: 320 });
    });
  }, [elements, ready]);

  // highlight the focused company's paths
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !ready) return;
    const focus = hovered ?? selected;
    cy.elements().removeClass("dim hl sel");
    if (!focus) return;
    const ex = exposures.find((e) => e.id === focus);
    const keepNodes = new Set<string>([focus]);
    const keepEdges = new Set<string>();
    ex?.paths.slice(0, 3).forEach((p) => {
      p.nodes.forEach((n) => keepNodes.add(n));
      p.steps.forEach((s) => keepEdges.add(`e${s.edge_id}`));
    });
    if (!ex) originIds.forEach((o) => keepNodes.add(o));
    cy.nodes().forEach((n) => {
      if (!keepNodes.has(n.id())) n.addClass("dim");
    });
    cy.edges().forEach((e) => {
      if (keepEdges.has(e.id())) e.addClass("hl");
      else e.addClass("dim");
    });
    cy.getElementById(focus).addClass("sel");
  }, [hovered, selected, exposures, originIds, ready, elements]);

  return (
    <div className="relative w-full h-full min-h-[340px]">
      <svg className="absolute inset-0 w-full h-full pointer-events-none" aria-hidden>
        <g transform={`translate(${view.x} ${view.y}) scale(${view.z})`}>
          {RADII.slice(1, maxRing + 1).map((r, i) => (
            <g key={r}>
              <circle r={r} fill="none" stroke="#1d232d" strokeWidth={1 / view.z} strokeDasharray={`${3 / view.z} ${5 / view.z}`} />
              <text x={0} y={-r - 6 / view.z} textAnchor="middle" fill="#4a5361" fontSize={10 / view.z}
                fontFamily="JetBrains Mono, monospace" letterSpacing={1 / view.z}>
                HOP {i + 1}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {/* inline style: cytoscape adds a class that would otherwise force position: relative */}
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
