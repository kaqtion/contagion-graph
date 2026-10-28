"""Step 5: (re)create the worked examples shown on the home page.

    python -m scripts.seed_demos            # trace only (free)
    python -m scripts.seed_demos --explain  # also generate explanations + critic (a few cents in total)

Events are written by hand so the trace is free and reproducible; explanations use the live pipeline.
"""
from __future__ import annotations

import sys

from sqlalchemy import delete

from contagion import pipeline
from contagion.db import Run, init_db, session
from contagion.graph import invalidate


def ev(event_type, severity, duration, companies=(), regions=(), commodities=(), polarity="negative", summary=""):
    return {"event_type": event_type, "polarity": polarity, "severity": severity, "expected_duration": duration,
            "origin_companies": list(companies), "regions": list(regions), "commodities": list(commodities),
            "summary": summary}


DEMOS = [
    ("Earthquake halts TSMC fabs in Taiwan for several weeks",
     ev("regional_disaster", 4, "weeks", ["TSMC"], ["Taiwan"],
        summary="A major earthquake in Taiwan has stopped production at TSMC's fabs, with output expected to be down for weeks.")),
    ("Fire at Renesas Naka plant halts automotive chip production",
     ev("supply_disruption", 4, "months", ["Renesas Electronics"], ["Japan"],
        summary="A fire at Renesas' Naka fab has stopped a line making automotive microcontrollers, with recovery expected to take months.")),
    ("Nvidia warns data-center GPU shipments will slip a quarter",
     ev("supply_disruption", 3, "quarters", ["Nvidia"],
        summary="Nvidia expects shipments of its data-center GPUs to slip by about a quarter.")),
    ("Apple cuts iPhone production orders by 10% on weak demand",
     ev("demand_shock", 3, "quarters", ["Apple"],
        summary="Apple is cutting iPhone production orders by about 10% because demand is weaker than planned.")),
    ("Lithium prices spike as major supplier halts mine output",
     ev("commodity_shock", 3, "months", commodities=["lithium"],
        summary="Lithium prices have jumped after a major producer stopped mine output.")),
    ("US expands export controls on chipmaking tools sold to China",
     ev("sanctions_trade", 4, "permanent", regions=["China"],
        summary="The US has widened export controls on semiconductor manufacturing equipment sold to China.")),
]


def main(explain: bool) -> None:
    init_db()
    invalidate()
    with session() as s:
        s.execute(delete(Run).where(Run.is_demo.is_(True)))
        s.commit()
    for headline, event in DEMOS:
        run = pipeline.analyze(headline, event=event, is_demo=True)
        stats = run.result["stats"]
        print(f"{run.id}  {headline[:60]:60} reached={stats['reached']} paths={stats['paths']}")
        if explain:
            run = pipeline.explain(run.id)
            c = run.explanation.get("critic", {})
            print(f"          explained: {c.get('supported')}/{c.get('claims')} claims supported, ${run.cost_usd:.4f}")


if __name__ == "__main__":
    main("--explain" in sys.argv)
