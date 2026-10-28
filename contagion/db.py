"""Relational store for the graph, its evidence, runs and usage. SQLite locally, Postgres (Neon) when hosted."""
from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, Float, ForeignKey, Integer, String, Text, UniqueConstraint,
    create_engine, select,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.pool import NullPool

from . import config

if config.IS_SQLITE:
    engine = create_engine(config.DATABASE_URL, connect_args={"check_same_thread": False})
else:
    # Neon's pooled endpoint (PgBouncer, transaction mode) does the pooling, so serverless instances don't hold
    # connections open; psycopg's automatic server-side prepared statements are off because they don't survive
    # transaction-mode pooling.
    engine = create_engine(config.DATABASE_URL, poolclass=NullPool, connect_args={"prepare_threshold": None})
SessionLocal = sessionmaker(engine, expire_on_commit=False)


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Base(DeclarativeBase):
    pass


class Node(Base):
    """A company, region or commodity."""
    __tablename__ = "nodes"
    id: Mapped[str] = mapped_column(String(80), primary_key=True)  # e.g. NVDA, region:taiwan, commodity:neon
    kind: Mapped[str] = mapped_column(String(16))  # company | region | commodity
    name: Mapped[str] = mapped_column(String(200))
    ticker: Mapped[str | None] = mapped_column(String(20))
    cik: Mapped[str | None] = mapped_column(String(10))
    country: Mapped[str | None] = mapped_column(String(60))
    sector: Mapped[str | None] = mapped_column(String(40))
    in_universe: Mapped[bool] = mapped_column(Boolean, default=True)
    sec_filer: Mapped[bool] = mapped_column(Boolean, default=False)
    coverage: Mapped[str] = mapped_column(String(10), default="none")  # high | medium | low | none


class Alias(Base):
    __tablename__ = "aliases"
    alias: Mapped[str] = mapped_column(String(200), primary_key=True)  # normalised
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id"), primary_key=True)
    source: Mapped[str] = mapped_column(String(20), default="seed")


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    node_id: Mapped[str] = mapped_column(ForeignKey("nodes.id"))
    form: Mapped[str] = mapped_column(String(10))
    filed_at: Mapped[date] = mapped_column(Date)
    url: Mapped[str] = mapped_column(Text)
    accession: Mapped[str] = mapped_column(String(30), unique=True)


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("documents.id"))
    quote: Mapped[str] = mapped_column(Text)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)  # quote found verbatim in source
    source_label: Mapped[str] = mapped_column(String(200))  # "NVDA 10-K, 2026-02-25"
    url: Mapped[str | None] = mapped_column(Text)
    as_of: Mapped[date | None] = mapped_column(Date)


class Edge(Base):
    __tablename__ = "edges"
    __table_args__ = (UniqueConstraint("src", "dst", "rel"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    src: Mapped[str] = mapped_column(ForeignKey("nodes.id"), index=True)
    dst: Mapped[str] = mapped_column(ForeignKey("nodes.id"), index=True)
    # supplies_to (src supplies dst) | competes_with | operates_in (company->region)
    # depends_on (company->commodity) | produces (company->commodity)
    rel: Mapped[str] = mapped_column(String(20))
    strength: Mapped[float] = mapped_column(Float)
    tier: Mapped[str] = mapped_column(String(10), default="unknown")
    pct: Mapped[float | None] = mapped_column(Float)  # disclosed % of revenue/cost
    strength_source: Mapped[str] = mapped_column(String(10), default="tier")  # disclosed | tier | curated
    status: Mapped[str] = mapped_column(String(12), default="verified")  # verified | curated | pending | rejected
    as_of: Mapped[date | None] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(Text)


class EdgeEvidence(Base):
    __tablename__ = "edge_evidence"
    edge_id: Mapped[int] = mapped_column(ForeignKey("edges.id"), primary_key=True)
    evidence_id: Mapped[int] = mapped_column(ForeignKey("evidence.id"), primary_key=True)


class Run(Base):
    """One headline traced through the graph."""
    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(16), primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    headline: Mapped[str] = mapped_column(Text)
    headline_hash: Mapped[str] = mapped_column(String(64), index=True)
    event: Mapped[dict] = mapped_column(JSON)
    result: Mapped[dict] = mapped_column(JSON)
    explanation: Mapped[dict | None] = mapped_column(JSON)
    cost_usd: Mapped[float] = mapped_column(Float, default=0.0)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class LlmCall(Base):
    __tablename__ = "llm_calls"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    ts: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)
    ip_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    purpose: Mapped[str] = mapped_column(String(30))
    model: Mapped[str] = mapped_column(String(40))
    input_tokens: Mapped[int] = mapped_column(Integer)
    output_tokens: Mapped[int] = mapped_column(Integer)
    cost_usd: Mapped[float] = mapped_column(Float)


class Backtest(Base):
    __tablename__ = "backtests"
    key: Mapped[str] = mapped_column(String(40), primary_key=True)
    data: Mapped[dict] = mapped_column(JSON)


class ReviewDecision(Base):
    """Human review outcome for an edge; survives graph rebuilds. key = 'src|rel|dst'."""
    __tablename__ = "review_decisions"
    key: Mapped[str] = mapped_column(String(200), primary_key=True)
    status: Mapped[str] = mapped_column(String(12))  # verified | rejected
    decided_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Unresolved(Base):
    """Names the extractor found that we could not map to a node (review queue input)."""
    __tablename__ = "unresolved"
    raw: Mapped[str] = mapped_column(String(200), primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=1)
    example: Mapped[str | None] = mapped_column(Text)


def init_db() -> None:
    if config.DATABASE_URL_DIRECT == config.DATABASE_URL:
        Base.metadata.create_all(engine)
        return
    ddl = create_engine(config.DATABASE_URL_DIRECT, poolclass=NullPool)
    Base.metadata.create_all(ddl)
    ddl.dispose()


def session() -> Session:
    return SessionLocal()


__all__ = [
    "Alias", "Backtest", "Base", "Document", "Edge", "EdgeEvidence", "Evidence", "LlmCall", "Node",
    "ReviewDecision", "Run", "Unresolved", "engine", "init_db", "select", "session", "utcnow",
]
