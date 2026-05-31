# Spec — Tela de jogos com filtros, ordenação e busca

**Data:** 2026-05-30 · **Status:** aprovado (brainstorming) · **Rota:** `/fixtures`

## Objetivo
Dar à lista de jogos do dia: ordenação, filtros (liga, IA, edge, destaques, com-dados), busca por time, e toggle de agrupamento (por liga ⇄ cronológico plano). Tudo **instantâneo** — os ~48 jogos do dia já vêm carregados, então filtra/ordena no cliente, sem round-trip.

## Decisões (Pilot)
- **View:** toggle agrupar ⇄ tempo; **lembra a escolha** (localStorage); começa agrupado.
- **Edge da IA:** mostrar `⚡IA +18%` no card; ordenar por maior edge; filtrar por edge mínimo. Exige puxar `edge_pct` na query (display de dado já computado — não toca modelo).

## Arquitetura
- `page.tsx` (Server) inalterada exceto: passa os fixtures pro `FixturesBrowser` (Client) em vez do `FixturesList`. Continua lendo só `?date`.
- **Filtro/ordenação/busca 100% client-side** (em memória). Resposta instantânea, sem cold-start por toggle.
- **Estado:**
  - *Preferências sticky* (localStorage): `view` (grouped/flat) + `sort`.
  - *Filtros ativos* (client state, espelhados na URL via `history.replaceState` — compartilhável, sobrevive refresh, **sem** disparar re-render do servidor): `leagues`, `ia`, `minEdge`, `highSignalOnly`, `hideOff`, `query`.
  - Trocar o dia (DateChips) reseta filtros (comportamento esperado).
- **Divergência consciente do `/bets`:** lá os filtros usam `router.push` (re-query no servidor, ok porque os dados mudam). Aqui a lista inteira do dia já está no cliente → `replaceState` + filtro em memória é instantâneo e evita o cold-start. Documentado.

## Backend (mínimo)
`fetchAiVerdicts` (repository.ts) passa a trazer `edge_pct` na query que já existe (`fixture_id, verdict, edge_pct`); agrega o **maior edge** entre os mercados `verdict='bet'` da fixture. Novo campo `ai_edge_pct?: number` no `FixtureDTO`. Guard de payload (B12/B14) intacto — só escalar a mais.

## Componentes
- `lib/fixtures/filter-sort.ts` — **puro/testável**: `FilterState`, `DEFAULT_FILTER_STATE`, `availableLeagues(fixtures)` (só ligas do dia + contagem, via `groupFixturesByLeague`), `iaCategory(f)`, `normalize()` (lower + sem acento), `applyFiltersAndSort(fixtures, state)`.
- `components/fixtures/fixtures-browser.tsx` (Client) — estado + URL sync + localStorage; renderiza barra + lista (agrupada via `groupFixturesByLeague` reusado, ou plana ordenada).
- `components/fixtures/fixtures-filter-bar.tsx` (Client) — sort ▾, toggle view, multi-select liga, toggles IA (aposta/sem-valor/não-analisado), edge mínimo, busca, "limpar (N)" + contador de resultados. **Mobile S23 FE:** linha compacta (sort+view+busca) + botão "filtros" abrindo bottom-sheet (Radix Dialog) com liga/IA/edge/reset.
- `FixtureCard` — chip ganha edge (`⚡IA +18%`); nova prop `showLeague` (modo plano mostra bandeira+liga inline).
- `page.tsx` — troca `<FixturesList>` por `<FixturesBrowser>`.

## Filtros/ordenação (completo)
- **Ordenar:** horário ↑ (default) · maior edge ↓ (sem-edge no fim) · destaques primeiro (ai_has_bet > high_signal > horário).
- **Filtrar:** liga (multi, key `league|country`) · IA (bet/novalue/unanalyzed, vazio=todos) · edge mínimo (nº) · só destaques (high_signal) · esconder OFF (has_detail=false) · busca por time (substring sem acento em home/away).

## Testes (TDD)
- **Unit** `filter-sort.test.ts`: cada filtro isolado + combinados; cada sort; `availableLeagues` contagem/ordem; busca sem acento; `iaCategory`.
- **Unit** `repository.test.ts`: agregação max-edge por fixture (estende buildMultiMock; select inclui `edge_pct`).
- **Component** `fixture-card-edge.test.tsx`: chip com edge; `showLeague` mostra liga/bandeira; sem edge não quebra.
- **Component** `fixtures-browser.test.tsx`: toggle de filtro esconde/mostra; troca view grouped/flat; empty-state; contador; busca.
- **E2E** Playwright (logado): aplica filtro liga+IA, confere contagem, troca view.

## Fora de escopo (YAGNI)
Presets salvos · colapso por liga · scroll infinito (48 linhas) · filtro server-side.

## Acessibilidade / DS
Tokens Abismo Habitado; `.num`/`tabular-nums` no edge%; Fraunces nos headings; reduced-motion respeitado; controles via Radix (teclado/ARIA). Sem notificação de sucesso.
