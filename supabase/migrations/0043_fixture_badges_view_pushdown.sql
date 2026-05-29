-- ============================================================
-- fixture_badges_view — reescrita para predicate pushdown (perf).
--
-- PROBLEMA (revisão de perf 2026-05-29, Lição B21): a definição de 0017
-- computava as CTEs `strong_streaks` (GroupAggregate + jsonb_array_elements)
-- e `referee_flag` (seq scan) sobre a tabela `fixtures` INTEIRA antes do
-- join, e só então aplicava o filtro `fixture_id IN (...)` do PostgREST no
-- topo. Resultado medido em prod (EXPLAIN ANALYZE, 390 fixtures, pedindo 48):
-- expandia ~84k linhas de streaks de ~357 fixtures + seq-scan de referee em
-- 390 — **679 ms** por request, recomputado a CADA leitura da lista/API
-- (`/fixtures` TTFB ~1,1 s; `/api/fixtures` ~800 ms). O `detail_json` só muda
-- no scrape (1×/dia), então recomputar por leitura é puro desperdício.
--
-- FIX: reescrever como UM passe `from fixtures f` com subqueries LATERAL
-- correlacionadas em `f.detail_json`. Assim o filtro `f.id = ANY(ids)` é
-- aplicado PRIMEIRO (Bitmap Index Scan no pkey) e os laterais só rodam para
-- as linhas filtradas. EXPLAIN ANALYZE pós-fix (mesmos 48 ids): **83 ms**,
-- `loops=48` (não a tabela inteira). ~8× mais rápido.
--
-- PARIDADE: a saída é IDÊNTICA à de 0017 — verificado contra prod, 390/390
-- linhas, 0 divergências (badges[] e high_signal). O contrato escalar
-- `(fixture_id bigint, badges text[], high_signal boolean)` não muda, então
-- nenhum código de aplicação (`lib/fixtures/repository.ts#fetchBadgeView`)
-- precisa mudar. `create or replace view` é reversível (re-aplicar 0017).
--
-- THRESHOLDS — fonte única TS: lib/fixtures/badge-thresholds.ts
-- Ao mudar qualquer literal numérico/substring abaixo, edite TAMBÉM
-- badge-thresholds.ts na mesma PR. O teste
-- lib/fixtures/badge-thresholds.parity.test.ts (que agora aponta para ESTE
-- arquivo) detecta divergência.
--
-- Mapeamento SQL → TS (idêntico a 0017):
--   perc >= 70              → STREAK_PERC_MIN
--   > 45                    → REFEREE_BOOKING_THRESHOLD
--   >= 3                    → REFEREE_2YA_THRESHOLD
--   >= 5                    → REFEREE_MIN_COMPLETED
--   like '%over 2.5%'       → STREAK_OVER25_SUBSTR
--   like '%btts%'           → STREAK_BTTS_SUBSTRS[0]
--   like '%both teams%'     → STREAK_BTTS_SUBSTRS[1]
--   like '%1h %'            → STREAK_FH_SUBSTRS[0]
--   like '%first half%'     → STREAK_FH_SUBSTRS[1]
--   like '%1st half%'       → STREAK_FH_SUBSTRS[2]
--   [1:3]                   → MAX_BADGES
--   high_signal             → array_length(badges) >= 2 (HIGH_SIGNAL_MIN_BADGES)
--
-- Cast tolerante mantido de 0017: nullif(trim(val),'')::numeric converte
-- string vazia em NULL antes do cast (replicando o `?? fallback` do TS).
-- ============================================================

create or replace view public.fixture_badges_view
with (security_invoker = true)
as
select
  f.id as fixture_id,
  b.badges,
  (coalesce(array_length(b.badges, 1), 0) >= 2) as high_signal
from public.fixtures f
cross join lateral (
  -- Monta o slug array na ordem de computeBadges() (badges.ts) e corta em 3.
  select (
    array_remove(array[
      case when ref.cards then 'cartao-alto'    end,
      case when ss.b_over then 'over-alto'      end,
      case when ss.b_btts then 'btts-alto'      end,
      case when ss.b_fh   then 'primeiro-tempo' end
    ], null)
  )[1:3] as badges
  from
    -- strong_streaks escopado a ESTA fixture: over/btts/first-half exigem que
    -- AMBOS os lados (home E away) tenham um streak forte (overall_perc >= 70)
    -- cujo texto (stat_type || ' ' || desc, lower) bata na substring.
    lateral (
      select
        coalesce(bool_or(side = 'home' and perc >= 70 and txt like '%over 2.5%'), false)
          and coalesce(bool_or(side = 'away' and perc >= 70 and txt like '%over 2.5%'), false) as b_over,
        coalesce(bool_or(side = 'home' and perc >= 70 and (txt like '%btts%' or txt like '%both teams%')), false)
          and coalesce(bool_or(side = 'away' and perc >= 70 and (txt like '%btts%' or txt like '%both teams%')), false) as b_btts,
        coalesce(bool_or(side = 'home' and perc >= 70 and (txt like '%1h %' or txt like '%first half%' or txt like '%1st half%')), false)
          and coalesce(bool_or(side = 'away' and perc >= 70 and (txt like '%1h %' or txt like '%first half%' or txt like '%1st half%')), false) as b_fh
      from (values ('home'), ('away')) as s(side)
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(f.detail_json->'streaks'->s.side) = 'array'
            then f.detail_json->'streaks'->s.side
          else '[]'::jsonb
        end
      ) as elem
      cross join lateral (
        select
          coalesce(nullif(trim(elem->>'overall_perc'), '')::numeric, -1)            as perc,
          lower(coalesce(elem->>'stat_type', '') || ' ' || coalesce(elem->>'desc', '')) as txt
      ) v
    ) ss
    cross join lateral (
      -- referee: amostra (completed/fixtures_count) >= 5 E
      --          (avg_total_booking_points > 45 OU total_yellow_reds >= 3).
      select (
        jsonb_typeof(f.detail_json->'referee_record') = 'object'
        and coalesce(
              nullif(trim(f.detail_json->'referee_record'->>'completed'),     '')::numeric,
              nullif(trim(f.detail_json->'referee_record'->>'fixtures_count'), '')::numeric,
              0
            ) >= 5
        and (
          coalesce(nullif(trim(f.detail_json->'referee_record'->>'avg_total_booking_points'), '')::numeric, -1) > 45
          or coalesce(nullif(trim(f.detail_json->'referee_record'->>'total_yellow_reds'), '')::numeric, -1) >= 3
        )
      ) as cards
    ) ref
) b;

-- Mantém o grant de 0017 (SECURITY INVOKER; RLS da fixtures aplica).
grant select on public.fixture_badges_view to authenticated;
