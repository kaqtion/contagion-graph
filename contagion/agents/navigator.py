"""Graph navigator: deterministic traversal templates per event type (no free-form queries).

A path starts at an origin node (company, region or commodity) and walks up to MAX_HOPS edges.
Supply edges keep one direction for the whole path (downstream = towards customers, upstream = towards
suppliers). Competitor edges are only taken from a company origin and end the path, with sign -1.
"""
from __future__ import annotations

from dataclasses import dataclass

from .. import config
from ..graph import Graph

# moves: which supply directions a path may take; competitors: add competitor edges at the origin
TEMPLATES: dict[str, dict] = {
    "supply_disruption": {"moves": ["down"], "competitors": True, "region_seed": False},
    "regional_disaster": {"moves": ["down"], "competitors": True, "region_seed": True},
    "cyber_outage": {"moves": ["down"], "competitors": True, "region_seed": False},
    "demand_shock": {"moves": ["up"], "competitors": True, "region_seed": False},
    "financial_distress": {"moves": ["up", "down"], "competitors": True, "region_seed": False},
    "commodity_shock": {"moves": ["down"], "competitors": False, "region_seed": False},
    "sanctions_trade": {"moves": ["up", "down"], "competitors": False, "region_seed": True, "max_hops": 2},
    "regulatory": {"moves": ["down"], "competitors": True, "region_seed": True, "max_hops": 2},
    "capacity_expansion": {"moves": ["down"], "competitors": True, "region_seed": False},
    "macro_rates": {"moves": [], "competitors": False, "region_seed": False, "max_hops": 0},
}


@dataclass
class Step:
    edge_id: int
    frm: str
    to: str
    kind: str  # down | up | competitor | located_in | uses | produces
    w: float
    sign: int


@dataclass
class Path:
    origin: str
    steps: list[Step]

    @property
    def end(self) -> str:
        return self.steps[-1].to if self.steps else self.origin

    @property
    def raw_weight(self) -> float:
        p = 1.0
        for s in self.steps:
            p *= s.w
        return p

    @property
    def sign(self) -> int:
        sg = 1
        for s in self.steps:
            sg *= s.sign
        return sg

    def visits(self, node: str) -> bool:
        return node == self.origin or any(s.to == node for s in self.steps)


def _first_steps(g: Graph, origin: str, tpl: dict, blocked: set[str]) -> list[Path]:
    kind = g.nodes[origin]["kind"]
    paths: list[Path] = []
    if kind == "region":
        for e in g.inn.get(origin, []):
            if e.rel == "operates_in" and e.src not in blocked:
                paths.append(Path(origin, [Step(e.id, origin, e.src, "located_in", e.strength, 1)]))
    elif kind == "commodity":
        for e in g.inn.get(origin, []):
            if e.src in blocked:
                continue
            if e.rel == "depends_on":
                paths.append(Path(origin, [Step(e.id, origin, e.src, "uses", e.strength, 1)]))
            elif e.rel == "produces":
                paths.append(Path(origin, [Step(e.id, origin, e.src, "produces", e.strength, -1)]))
    else:
        paths.extend(_extend(g, Path(origin, []), tpl, blocked))
        if tpl["competitors"]:
            for e in g.out.get(origin, []) + g.inn.get(origin, []):
                if e.rel == "competes_with":
                    other = e.dst if e.src == origin else e.src
                    paths.append(Path(origin, [Step(e.id, origin, other, "competitor", e.strength, -1)]))
    return paths


def _direction(p: Path) -> str | None:
    for s in p.steps:
        if s.kind in ("down", "up"):
            return s.kind
    return None


def _extend(g: Graph, p: Path, tpl: dict, blocked: set[str]) -> list[Path]:
    if p.steps and p.steps[-1].kind in ("competitor", "produces"):
        return []  # terminal edges
    node = p.end
    fixed = _direction(p)
    out = []
    for move in tpl["moves"]:
        if fixed and move != fixed:
            continue
        candidates = g.out.get(node, []) if move == "down" else g.inn.get(node, [])
        for e in candidates:
            if e.rel != "supplies_to":
                continue
            nxt = e.dst if move == "down" else e.src
            if p.visits(nxt) or nxt in blocked or g.nodes.get(nxt, {}).get("kind") != "company":
                continue
            out.append(Path(p.origin, p.steps + [Step(e.id, node, nxt, move, e.strength, 1)]))
    return out


def find_paths(g: Graph, origins: list[str], event_type: str) -> list[Path]:
    tpl = TEMPLATES[event_type]
    max_hops = tpl.get("max_hops", config.MAX_HOPS)
    if max_hops == 0:
        return []
    all_paths: list[Path] = []
    frontier: list[Path] = []
    # company origins are scored directly; other paths must not route through them (no double counting)
    blocked = {o for o in origins if g.nodes[o]["kind"] == "company"}
    for o in origins:
        frontier.extend(_first_steps(g, o, tpl, blocked))
    hop = 1
    while frontier and hop <= max_hops:
        frontier = [p for p in frontier if p.raw_weight * config.HOP_DECAY ** (hop - 1) >= config.MIN_PATH_WEIGHT]
        # beam: keep the strongest partial paths at each hop, at most 3 per end node
        frontier.sort(key=lambda p: -p.raw_weight)
        per_node: dict[str, int] = {}
        kept = []
        for p in frontier:
            if per_node.get(p.end, 0) >= 3:
                continue
            per_node[p.end] = per_node.get(p.end, 0) + 1
            kept.append(p)
            if len(kept) >= config.BEAM_PER_HOP:
                break
        all_paths.extend(kept)
        hop += 1
        if hop > max_hops:
            break
        frontier = [q for p in kept for q in _extend(g, p, tpl, blocked)]
    return all_paths
