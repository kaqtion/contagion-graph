"use client";

import { useEffect, useRef } from "react";
import type { Core } from "cytoscape";
import { useRouter } from "next/navigation";
import type { EdgeInfo, NodeInfo } from "@/lib/api";
import { label, monoFont } from "@/lib/format";

// One company's neighbourhood: suppliers on the left, customers on the right,
// competitors below, regions and commodities above.
export default function EgoGraph({ center, nodes, edges }: { center: string; nodes: NodeInfo[]; edges: EdgeInfo[] }) {
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    let cy: Core | null = null;
    let ro: ResizeObserver | null = null;
    let cancelled = false;
    (async () => {
      const cytoscape = (await import("cytoscape")).default;
      if (cancelled || !box.current) return;
      const byId = new Map(nodes.map((n) => [n.id, n]));
      const groups: Record<string, string[]> = { sup: [], cus: [], comp: [], ctx: [] };
      const role = new Map<string, string>();
      for (const e of edges) {
        const other = e.src === center ? e.dst : e.src;
        if (role.has(other)) continue;
        const g = e.rel === "supplies_to" ? (e.dst === center ? "sup" : "cus") : e.rel === "competes_with" ? "comp" : "ctx";
        role.set(other, g);
        groups[g].push(other);
      }
      const arcs: Record<string, [number, number]> = {
        sup: [Math.PI * 0.62, Math.PI * 1.38],
        cus: [-Math.PI * 0.38, Math.PI * 0.38],
        comp: [Math.PI * 0.62, Math.PI * 0.38],
        ctx: [-Math.PI * 0.62, -Math.PI * 0.38],
      };
      const pos = new Map<string, { x: number; y: number }>([[center, { x: 0, y: 0 }]]);
      for (const [g, ids] of Object.entries(groups)) {
        const [a0, a1] = arcs[g];
        const R = 200 + Math.max(0, ids.length - 10) * 6;
        ids.forEach((id, i) => {
          const t = ids.length === 1 ? 0.5 : i / (ids.length - 1);
          const a = g === "comp" ? Math.PI / 2 + (t - 0.5) * 0.9 : a0 + (a1 - a0) * t;
          pos.set(id, { x: R * Math.cos(a), y: R * Math.sin(a) });
        });
      }
      const colors: Record<string, string> = { sup: "#8b94a5", cus: "#8b94a5", comp: "#3a88ee", ctx: "#6b5a2e" };
      cy = cytoscape({
        container: box.current,
        layout: { name: "preset" },
        autoungrabify: true,
        minZoom: 0.3,
        maxZoom: 2,
        elements: [
          ...[...pos.entries()].map(([id, p]) => {
            const n = byId.get(id);
            return {
              group: "nodes" as const,
              data: { id, label: n ? label(n) : id, color: id === center ? "#f2b544" : colors[role.get(id) ?? "sup"], size: id === center ? 34 : 18, shape: n && n.kind !== "company" ? "round-diamond" : "ellipse" },
              position: p,
            };
          }),
          ...edges
            .filter((e) => pos.has(e.src) && pos.has(e.dst))
            .map((e) => ({
              group: "edges" as const,
              data: { id: `e${e.id}`, source: e.src, target: e.dst, w: 0.6 + 2 * e.strength },
              classes: e.quality === "verified" ? "" : e.strength_source === "curated" ? "curated" : "stale",
            })),
        ],
        style: [
          {
            selector: "node",
            style: {
              width: "data(size)", height: "data(size)", shape: "data(shape)" as never, "background-color": "data(color)",
              label: "data(label)", color: "#c9ced8", "font-size": 10, "font-family": monoFont(),
              "text-valign": "bottom", "text-margin-y": 4, "text-outline-color": "#0b0c0e", "text-outline-width": 2.5,
            },
          },
          {
            selector: "edge",
            style: { width: "data(w)", "line-color": "#343c4a", "curve-style": "bezier", "target-arrow-shape": "triangle", "target-arrow-color": "#343c4a", "arrow-scale": 0.7 },
          },
          { selector: "edge.curated", style: { "line-style": "dotted" } },
          { selector: "edge.stale", style: { "line-style": "dashed" } },
        ],
      });
      cy.on("tap", "node", (e) => {
        const id = e.target.id();
        if (id !== center && !id.startsWith("region:") && !id.startsWith("commodity:")) router.push(`/explorer/${encodeURIComponent(id)}`);
      });
      const fit = () => {
        cy?.resize();
        cy?.fit(undefined, 30);
        if (cy && cy.zoom() > 1.4) {
          cy.zoom(1.4);
          cy.center();
        }
      };
      fit();
      ro = new ResizeObserver(fit);
      ro.observe(box.current);
    })();
    return () => {
      cancelled = true;
      ro?.disconnect();
      cy?.destroy();
    };
  }, [center, nodes, edges, router]);

  return (
    <div className="relative w-full h-full min-h-[360px]">
      <div className="absolute top-3 left-4 eyebrow">← suppliers</div>
      <div className="absolute top-3 right-4 eyebrow">customers →</div>
      <div ref={box} style={{ position: "absolute", inset: 0 }} />
    </div>
  );
}
