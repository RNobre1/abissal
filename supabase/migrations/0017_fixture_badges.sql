-- ============================================================
-- Adam-stats integration — fixture badges computed in Postgres.
--
-- B12 follow-up #1: the dashboard "Destaques do dia" used to pull
-- detail_json->streaks + detail_json->referee_record into the Cloudflare
-- Worker (~22-26 MB/day at peak) to run computeBadges() in JS — IDENTICAL
-- payload class to the 1101 outage. This view ports computeBadges()
-- (lib/fixtures/badges.ts) to PURE SQL so the heavy JSON NEVER leaves
-- Postgres. The Worker receives only scalars: a text[] of badge slugs and
-- a high_signal boolean per fixture.
--
-- THRESHOLDS — fonte única TS: lib/fixtures/badge-thresholds.ts
-- Ao mudar qualquer literal numérico ou substring abaixo, edite TAMBÉM
-- badge-thresholds.ts na mesma PR. O teste
-- lib/fixtures/badge-thresholds.parity.test.ts detecta divergência.
--
-- Mapeamento SQL → TS:
--   perc >= 70              → STREAK_PERC_MIN          (CTE strong_streaks)
--   > 45                    → REFEREE_BOOKING_THRESHOLD  (CTE referee_flag)
--   >= 3                    → REFEREE_2YA_THRESHOLD      (CTE referee_flag)
--   >= 5                    → REFEREE_MIN_COMPLETED      (CTE referee_flag)
--   like '%over 2.5%'       → STREAK_OVER25_SUBSTR       (CTE strong_streaks)
--   like '%btts%'           → STREAK_BTTS_SUBSTRS[0]     (CTE strong_streaks)
--   like '%both teams%'     → STREAK_BTTS_SUBSTRS[1]     (CTE strong_streaks)
--   like '%1h %'            → STREAK_FH_SUBSTRS[0]       (CTE strong_streaks)
--   like '%first half%'     → STREAK_FH_SUBSTRS[1]       (CTE strong_streaks)
--   like '%1st half%'       → STREAK_FH_SUBSTRS[2]       (CTE strong_streaks)
--   [1:3]                   → MAX_BADGES                 (CTE badge_arrays)
--
-- Assincronia de cast: (jsonb->>'campo')::numeric lança erro se o valor for
-- string não-numérica (e.g. ""). O TS usa `?? 0` que trata null/undefined mas
-- deixaria string passar; aqui usamos `nullif(trim(val),'')::numeric` para
-- converter string vazia em NULL antes do cast — NULL propaga como -1/0 via
-- COALESCE, replicando o comportamento de fallback do TS.
--
-- Thresholds mirror lib/fixtures/badge-thresholds.ts exactly:
--   - referee: completed (or fixtures_count) >= 5 AND
--              (avg_total_booking_points > 45 OR total_yellow_reds >= 3)
--   - streak "strong": overall_perc >= 70
--   - over/btts/first-half: BOTH home AND away must have a strong streak
--   - badge cap: 3 (cards, over, btts, first-half — in that priority order)
--   - high_signal: >= 2 badges (HIGH_SIGNAL_MIN_BADGES)
-- ============================================================

create or replace view public.fixture_badges_view
with (security_invoker = true)
as
with strong_streaks as (
  -- One row per fixture with booleans for each side/category, derived from
  -- detail_json->streaks. A streak is "strong" when overall_perc >= 70 and
  -- its (stat_type || ' ' || desc) text matches the category substring,
  -- matching streakText()/streakStrong()/is*Streak() in badges.ts.
  select
    f.id as fixture_id,
    bool_or(
      side = 'home' and perc >= 70 and txt like '%over 2.5%'
    ) as home_over,
    bool_or(
      side = 'away' and perc >= 70 and txt like '%over 2.5%'
    ) as away_over,
    bool_or(
      side = 'home' and perc >= 70 and (txt like '%btts%' or txt like '%both teams%')
    ) as home_btts,
    bool_or(
      side = 'away' and perc >= 70 and (txt like '%btts%' or txt like '%both teams%')
    ) as away_btts,
    bool_or(
      side = 'home' and perc >= 70
        and (txt like '%1h %' or txt like '%first half%' or txt like '%1st half%')
    ) as home_fh,
    bool_or(
      side = 'away' and perc >= 70
        and (txt like '%1h %' or txt like '%first half%' or txt like '%1st half%')
    ) as away_fh
  from public.fixtures f
  cross join lateral (
    select
      s.side,
      coalesce(nullif(trim(elem->>'overall_perc'),'')::numeric, -1)  as perc,
      lower(
        coalesce(elem->>'stat_type', '') || ' ' || coalesce(elem->>'desc', '')
      )                                                              as txt
    from (values ('home'), ('away')) as s(side)
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(f.detail_json->'streaks'->s.side) = 'array'
          then f.detail_json->'streaks'->s.side
        else '[]'::jsonb
      end
    ) as elem
  ) flat
  group by f.id
),
referee_flag as (
  -- Cast tolerante: nullif(trim(val),'')::numeric converte string vazia em
  -- NULL antes do cast, replicando o comportamento do TS `ref.completed ?? 0`
  -- que falha silenciosamente em vez de lançar erro. Valores não-numéricos
  -- (e.g. "") viram NULL → COALESCE propaga para 0 / -1 como fallback seguro.
  select
    f.id as fixture_id,
    (
      coalesce(
        nullif(trim(f.detail_json->'referee_record'->>'completed'),    '')::numeric,
        nullif(trim(f.detail_json->'referee_record'->>'fixtures_count'),'')::numeric,
        0
      ) >= 5
      and (
        coalesce(
          nullif(trim(f.detail_json->'referee_record'->>'avg_total_booking_points'),'')::numeric,
          -1
        ) > 45
        or coalesce(
          nullif(trim(f.detail_json->'referee_record'->>'total_yellow_reds'),'')::numeric,
          -1
        ) >= 3
      )
    ) as cards
  from public.fixtures f
  where jsonb_typeof(f.detail_json->'referee_record') = 'object'
),
flags as (
  select
    f.id as fixture_id,
    coalesce(rf.cards, false)                                       as b_cards,
    coalesce(ss.home_over, false)  and coalesce(ss.away_over, false) as b_over,
    coalesce(ss.home_btts, false)  and coalesce(ss.away_btts, false) as b_btts,
    coalesce(ss.home_fh, false)    and coalesce(ss.away_fh, false)   as b_fh
  from public.fixtures f
  left join referee_flag    rf on rf.fixture_id = f.id
  left join strong_streaks  ss on ss.fixture_id = f.id
),
badge_arrays as (
  select
    fixture_id,
    -- Build the slug array in computeBadges() order, then cap at 3.
    (
      array_remove(array[
        case when b_cards then 'cartao-alto'   end,
        case when b_over  then 'over-alto'     end,
        case when b_btts  then 'btts-alto'     end,
        case when b_fh    then 'primeiro-tempo' end
      ], null)
    )[1:3] as badges
  from flags
)
select
  fixture_id,
  badges,
  (coalesce(array_length(badges, 1), 0) >= 2) as high_signal
from badge_arrays;

-- View runs SECURITY INVOKER; the querying role's RLS on fixtures applies.
-- fixtures is reference data (authenticated SELECT true), and dashboard
-- reads use the service_role admin client anyway. Mirror 0004_views grants.
grant select on public.fixture_badges_view to authenticated;
