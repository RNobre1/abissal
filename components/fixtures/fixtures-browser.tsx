"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FixtureDTO } from "@/lib/fixtures/types";
import { groupFixturesByLeague } from "@/lib/fixtures/leagues";
import {
  DEFAULT_FILTER_STATE,
  applyFiltersAndSort,
  availableLeagues,
  type FilterState,
  type SortMode,
  type ViewMode,
} from "@/lib/fixtures/filter-sort";
import { decodeFilters, encodeFilters } from "@/lib/fixtures/filter-url";
import { FixtureCard } from "./fixture-card";
import { FixturesFilterBar } from "./fixtures-filter-bar";

/**
 * FixturesBrowser — dono do estado de filtro/ordenação/view da tela de jogos.
 * Recebe TODOS os jogos do dia (já carregados pelo Server Component) e filtra
 * em memória — instantâneo, sem round-trip. View+sort persistem em localStorage
 * ("lembra a escolha"); filtros ativos espelham na URL via history.replaceState
 * (compartilhável + sobrevive refresh, SEM disparar re-render do servidor).
 */

const PREFS_KEY = "abissal:fixtures:prefs";

function loadPrefs(): Partial<Pick<FilterState, "view" | "sort">> {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as { view?: string; sort?: string };
    const out: Partial<Pick<FilterState, "view" | "sort">> = {};
    if (o.view === "grouped" || o.view === "flat") out.view = o.view as ViewMode;
    if (o.sort === "kickoff" || o.sort === "edge" || o.sort === "signal") {
      out.sort = o.sort as SortMode;
    }
    return out;
  } catch {
    return {};
  }
}

export function FixturesBrowser({ fixtures }: { fixtures: FixtureDTO[] }) {
  const [state, setState] = useState<FilterState>(DEFAULT_FILTER_STATE);
  const hydrated = useRef(false);

  // Hidrata no cliente: prefs (localStorage) + filtros (URL). URL vence.
  // setState-in-effect é INTENCIONAL aqui: localStorage/URL só existem no
  // cliente, então ler na inicialização do useState causaria hydration
  // mismatch com o HTML do SSR (que renderiza o DEFAULT). É a exceção
  // documentada da regra — um único re-render pós-mount, sem cascata.
  useEffect(() => {
    const prefs = loadPrefs();
    const urlPart = decodeFilters(window.location.search);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- hidratação client-only (ver acima)
    setState((s) => ({ ...s, ...prefs, ...urlPart }));
  }, []);

  // Persiste prefs + espelha filtros na URL (replaceState — sem navegação).
  useEffect(() => {
    if (!hydrated.current) {
      hydrated.current = true;
      return;
    }
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({ view: state.view, sort: state.sort }),
      );
    } catch {
      // localStorage indisponível — segue sem persistir.
    }
    const date = new URLSearchParams(window.location.search).get("date");
    const params = new URLSearchParams(encodeFilters(state));
    if (date) params.set("date", date);
    const search = params.toString();
    window.history.replaceState(
      null,
      "",
      search ? `${window.location.pathname}?${search}` : window.location.pathname,
    );
  }, [state]);

  const patch = useCallback(
    (p: Partial<FilterState>) => setState((s) => ({ ...s, ...p })),
    [],
  );
  const reset = useCallback(
    () =>
      setState((s) => ({
        ...DEFAULT_FILTER_STATE,
        // mantém preferências de view/sort ao limpar FILTROS
        view: s.view,
        sort: s.sort,
      })),
    [],
  );

  const leagues = useMemo(() => availableLeagues(fixtures), [fixtures]);
  const filtered = useMemo(
    () => applyFiltersAndSort(fixtures, state),
    [fixtures, state],
  );

  return (
    <div data-fixtures-view={state.view}>
      <FixturesFilterBar
        state={state}
        leagues={leagues}
        resultCount={filtered.length}
        totalCount={fixtures.length}
        onChange={patch}
        onReset={reset}
      />

      {filtered.length === 0 ? (
        <EmptyState dirty={fixtures.length > 0} />
      ) : state.view === "grouped" ? (
        <GroupedList fixtures={filtered} />
      ) : (
        <FlatList fixtures={filtered} />
      )}
    </div>
  );
}

function GroupedList({ fixtures }: { fixtures: FixtureDTO[] }) {
  const groups = groupFixturesByLeague(fixtures);
  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => {
        const countryLabel = group.country
          ? group.country.charAt(0).toUpperCase() + group.country.slice(1)
          : null;
        return (
          <section
            key={group.key}
            data-league-group={group.key}
            aria-labelledby={`league-${group.key}`}
          >
            <header className="mb-3 flex items-baseline gap-3">
              <span aria-hidden className="text-base leading-none">
                {group.flag}
              </span>
              <h3
                id={`league-${group.key}`}
                className="label text-[var(--color-ink-muted)]"
              >
                {group.league}
                {countryLabel ? ` (${countryLabel})` : ""}
              </h3>
              <span className="label num text-[var(--color-ink-faint)]">
                {group.fixtures.length}
              </span>
            </header>
            <ul className="flex flex-col gap-2">
              {group.fixtures.map((fixture) => (
                <li key={fixture.id}>
                  <FixtureCard
                    fixture={fixture}
                    highSignal={fixture.high_signal === true}
                    aiHasBet={fixture.ai_has_bet === true}
                    aiNoValue={fixture.ai_no_value === true}
                    aiEdgePct={fixture.ai_edge_pct}
                  />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function FlatList({ fixtures }: { fixtures: FixtureDTO[] }) {
  return (
    <ul className="flex flex-col gap-2">
      {fixtures.map((fixture) => (
        <li key={fixture.id}>
          <FixtureCard
            fixture={fixture}
            highSignal={fixture.high_signal === true}
            aiHasBet={fixture.ai_has_bet === true}
            aiNoValue={fixture.ai_no_value === true}
            aiEdgePct={fixture.ai_edge_pct}
            showLeague
          />
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ dirty }: { dirty: boolean }) {
  return (
    <div className="card flex flex-col items-start gap-3 p-8">
      <span
        className="font-[var(--font-display)] text-2xl italic"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {dirty ? "nenhum jogo com esses filtros." : "sem jogos."}
      </span>
      <p className="max-w-prose text-sm text-[var(--color-ink-muted)]">
        {dirty
          ? "Ajuste ou limpe os filtros para ver mais jogos."
          : "Nenhum jogo no scraper para esta data. Tente outro dia."}
      </p>
    </div>
  );
}
