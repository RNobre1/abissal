import {
  DEFAULT_FILTER_STATE,
  type FilterState,
  type IaFilter,
  type SortMode,
  type ViewMode,
} from "./filter-sort";

/**
 * Serialização do FilterState ↔ query-string (pura/testável). O
 * `FixturesBrowser` espelha os filtros ativos na URL via `history.replaceState`
 * (compartilhável + sobrevive refresh, SEM disparar re-render do servidor — a
 * lista do dia já está toda no cliente). Só campos não-default entram, pra
 * manter a URL limpa. Multi-valores usam "~" como separador (keys de liga têm
 * "|"; "~" não colide).
 */

const SEP = "~";

export function encodeFilters(s: FilterState): string {
  const p = new URLSearchParams();
  if (s.view !== DEFAULT_FILTER_STATE.view) p.set("view", s.view);
  if (s.sort !== DEFAULT_FILTER_STATE.sort) p.set("sort", s.sort);
  if (s.leagues.length > 0) p.set("lg", s.leagues.join(SEP));
  if (s.ia.length > 0) p.set("ia", s.ia.join(SEP));
  if (s.minEdge != null) p.set("edge", String(s.minEdge));
  if (s.highSignalOnly) p.set("hs", "1");
  if (s.hideOff) p.set("off", "1");
  if (s.query.trim().length > 0) p.set("q", s.query.trim());
  return p.toString();
}

const SORTS: ReadonlySet<string> = new Set(["kickoff", "edge", "signal"]);
const VIEWS: ReadonlySet<string> = new Set(["grouped", "flat"]);
const IAS: ReadonlySet<string> = new Set(["bet", "novalue", "unanalyzed"]);

export function decodeFilters(search: string): Partial<FilterState> {
  const p = new URLSearchParams(search);
  const out: Partial<FilterState> = {};

  const view = p.get("view");
  if (view && VIEWS.has(view)) out.view = view as ViewMode;

  const sort = p.get("sort");
  if (sort && SORTS.has(sort)) out.sort = sort as SortMode;

  const lg = p.get("lg");
  if (lg) out.leagues = lg.split(SEP).filter(Boolean);

  const ia = p.get("ia");
  if (ia) {
    const items = ia.split(SEP).filter((v): v is IaFilter => IAS.has(v));
    if (items.length > 0) out.ia = items;
  }

  const edge = p.get("edge");
  if (edge != null) {
    const n = Number(edge);
    if (Number.isFinite(n)) out.minEdge = n;
  }

  if (p.get("hs") === "1") out.highSignalOnly = true;
  if (p.get("off") === "1") out.hideOff = true;

  const q = p.get("q");
  if (q && q.length > 0) out.query = q;

  return out;
}
