#!/usr/bin/env ruby
# frozen_string_literal: true
#
# T3 — diagnóstico do mecanismo por trás do "prior genérico"
# (ticket gate-placeholder-e-sizing/t3-prior-generico-shrinkage).
#
# SOMENTE LEITURA contra o motor: não altera rates.rb / season_avgs.rb /
# runner.rb nem MODEL_VERSION. `InstrumentedRates` abaixo é uma CÓPIA LOCAL
# do algoritmo puro de Rates.lambdas, só para expor os internos (n, w) que
# o módulo real esconde atrás de private_class_method — não é o arquivo real
# e não é usada por nenhum caminho de produção.
#
# Uso:
#   cd scripts/scraper && eval "$(mise activate bash)" && set -a && \
#     source ../../.env.local && set +a && \
#     mise x -- bundle exec ruby ../analysis/prior-generico-mecanismo.rb [--limit N] [--n MC_N]

require 'pg'
require 'json'
require 'time'
require 'digest'

SCRAPER_ROOT = File.expand_path('../scraper', __dir__)
require File.join(SCRAPER_ROOT, 'lib/scraper/simulation/runner')
require File.join(SCRAPER_ROOT, 'lib/scraper/simulation/league_calibration')

Runner            = AdamStats::Scraper::Simulation::Runner
SeasonAvgs        = AdamStats::Scraper::Simulation::SeasonAvgs
LeagueCalibration = AdamStats::Scraper::Simulation::LeagueCalibration

# ---------------------------------------------------------------------------
# InstrumentedRates — cópia local pura do algoritmo de Rates.lambdas,
# devolvendo n/w/λ por lado. Réplica byte-a-byte da matemática de
# scripts/scraper/lib/scraper/simulation/rates.rb (lido, não modificado).
# ---------------------------------------------------------------------------
module InstrumentedRates
  K = 5.0
  SHRINK_THRESHOLD = 15

  module_function

  def dig(obj, key)
    return nil unless obj.is_a?(Hash)

    obj[key] || obj[key.to_sym]
  end

  def num(obj, key)
    v = dig(obj, key)
    return nil if v.nil?

    Float(v)
  rescue ArgumentError, TypeError
    nil
  end

  def shrunk_detail(block, metric, league_value)
    team = num(block, metric)
    return { team: nil, n: nil, w: nil, value: nil } if team.nil?

    n = num(block, 'num_matches') || num(block, 'numMatches')
    return { team: team, n: n, w: 1.0, value: team } if n.nil? || n >= SHRINK_THRESHOLD

    w = n / (n + K)
    { team: team, n: n, w: w, value: (w * team) + ((1 - w) * league_value) }
  end

  # detail: hash com 'avgs' — EXATAMENTE o argumento que Rates.lambdas recebe
  # em produção (Runner.simulate passa `d`, o detail_json ORIGINAL, não o
  # `avgs` pós-SeasonAvgs.fill — achado B deste diagnóstico).
  def diagnose(detail, league_avgs)
    avgs = dig(detail, 'avgs')
    return { ok: false, reason: :no_avgs } unless avgs.is_a?(Hash)

    home = dig(avgs, 'home_home')
    away = dig(avgs, 'away_away')
    return { ok: false, reason: :no_blocks } unless home.is_a?(Hash) && away.is_a?(Hash)

    lg_for  = num(league_avgs, 'avg_goals_for')
    lg_ag   = num(league_avgs, 'avg_goals_ag')
    lg_home = num(league_avgs, 'avg_goals_home')
    lg_away = num(league_avgs, 'avg_goals_away')
    return { ok: false, reason: :bad_league } if [lg_for, lg_ag, lg_home, lg_away].any? { |v| v.nil? || v <= 0 }

    h_for = shrunk_detail(home, 'avgGoalsFor', lg_for)
    h_ag  = shrunk_detail(home, 'avgGoalsAg', lg_ag)
    a_for = shrunk_detail(away, 'avgGoalsFor', lg_for)
    a_ag  = shrunk_detail(away, 'avgGoalsAg', lg_ag)
    return { ok: false, reason: :missing_metric } if [h_for, h_ag, a_for, a_ag].any? { |x| x[:value].nil? }

    lambda_home = (h_for[:value] / lg_for) * (a_ag[:value] / lg_ag) * lg_home
    lambda_away = (a_for[:value] / lg_for) * (h_ag[:value] / lg_ag) * lg_away

    {
      ok: true,
      lambda_home: lambda_home, lambda_away: lambda_away,
      n_home: h_for[:n], n_away: a_for[:n],
      w_home: h_for[:w], w_away: a_for[:w],
      h_for: h_for[:team], h_ag: h_ag[:team], a_for: a_for[:team], a_ag: a_ag[:team],
      lg_for: lg_for, lg_ag: lg_ag, lg_home: lg_home, lg_away: lg_away
    }
  end
end

# ---------------------------------------------------------------------------
# Classificação de placeholder — reimplementação independente (não requer
# placeholder_guard.rb, que é trabalho não commitado de outra frente).
# ---------------------------------------------------------------------------
TEAM_PLACEHOLDER_RE = /\b(?:tbc|tbd)\b/i
BRACKET_PLACEHOLDER_RE = /\A\s*(?:winner|loser)\s+\S/i

def placeholder_team?(name)
  s = name.to_s.strip
  return true if s.empty?

  TEAM_PLACEHOLDER_RE.match?(s) || BRACKET_PLACEHOLDER_RE.match?(s)
end

def kickoff_placeholder?(match_date_str, kickoff_utc_str)
  return true if kickoff_utc_str.nil? || kickoff_utc_str.strip.empty?

  t = Time.parse(kickoff_utc_str).utc
  return false unless t.hour.zero? && t.min.zero? && t.sec.zero?

  t.strftime('%Y-%m-%d') == match_date_str
end

NEUTRAL_BASELINE = Runner::NEUTRAL_BASELINE

def approx?(a, b, eps)
  (a - b).abs <= eps
end

# ---------------------------------------------------------------------------
# Args
# ---------------------------------------------------------------------------
limit = nil
mc_n = 2000
ARGV.each_slice(2) do |k, v|
  limit = v.to_i if k == '--limit'
  mc_n = v.to_i if k == '--n'
end

conn = PG.connect(ENV.fetch('DATABASE_URL'))
calibration = LeagueCalibration.load(conn)
STDERR.puts "[info] calibration carregada: #{calibration.keys.size} ligas — #{calibration.keys.sort.join(', ')}"

league_avgs_blank = LeagueCalibration.baseline_for('', calibration) # o que Runner.simulate REALMENTE usa
STDERR.puts "[info] league_avgs que Runner.simulate usa (league='' sempre, achado A): #{league_avgs_blank.inspect}"
STDERR.puts "[info] == NEUTRAL_BASELINE? #{league_avgs_blank == NEUTRAL_BASELINE}"

sql = <<~SQL
  SELECT id, home_team, away_team, league, match_date::text AS match_date,
         kickoff_utc::text AS kickoff_utc,
         detail_json->'avgs' AS avgs_raw,
         detail_json->'recent_matches' AS recent_raw
  FROM fixtures
  ORDER BY id
  #{limit ? "LIMIT #{limit.to_i}" : ''}
SQL

res = conn.exec(sql)
STDERR.puts "[info] fixtures lidas: #{res.ntuples}"

cat_counts = Hash.new(0)
rows_ok = []

res.each do |row|
  if placeholder_team?(row['home_team']) || placeholder_team?(row['away_team'])
    cat_counts[:team_placeholder] += 1
    next
  end
  if kickoff_placeholder?(row['match_date'], row['kickoff_utc'])
    cat_counts[:kickoff_placeholder] += 1
    next
  end
  cat_counts[:ok] += 1
  rows_ok << row
end

STDERR.puts "[info] categorias: #{cat_counts.inspect}"
STDERR.puts "[info] identidade completa (ok): #{rows_ok.size} — instrumentando com n=#{mc_n}..."

records = []
t0 = Time.now
rows_ok.each_with_index do |row, i|
  avgs_raw = row['avgs_raw'] ? JSON.parse(row['avgs_raw']) : nil
  recent_raw = row['recent_raw'] ? JSON.parse(row['recent_raw']) : nil
  detail = { 'avgs' => avgs_raw, 'recent_matches' => recent_raw }

  # O que SeasonAvgs.fill produziria (usado por Runner só para o gate
  # usable_avgs? e para per_half/secondary — NUNCA chega em Rates.lambdas,
  # achado B).
  filled_avgs = SeasonAvgs.fill(avgs_raw, recent_raw)
  usable = Runner.send(:usable_avgs?, filled_avgs)

  raw_home = avgs_raw.is_a?(Hash) ? (avgs_raw['home_home'] || avgs_raw[:home_home]) : nil
  raw_away = avgs_raw.is_a?(Hash) ? (avgs_raw['away_away'] || avgs_raw[:away_away]) : nil
  filled_home = filled_avgs.is_a?(Hash) ? filled_avgs['home_home'] : nil
  filled_away = filled_avgs.is_a?(Hash) ? filled_avgs['away_away'] : nil

  raw_n_home = InstrumentedRates.num(raw_home, 'num_matches')
  raw_n_away = InstrumentedRates.num(raw_away, 'num_matches')
  filled_n_home = InstrumentedRates.num(filled_home, 'num_matches')
  filled_n_away = InstrumentedRates.num(filled_away, 'num_matches')

  degenerate_home = SeasonAvgs.degenerate?(raw_home)
  degenerate_away = SeasonAvgs.degenerate?(raw_away)

  # provenance do num_matches que ALIMENTARIA a sim se o fill estivesse
  # corretamente fiado (não é o que acontece hoje — ver diag_prod abaixo)
  prov_home = if !degenerate_home
                :raw_choistats
              elsif filled_n_home && filled_n_home > 0
                :derived_seasonavgs
              else
                :zero_or_missing
              end
  prov_away = if !degenerate_away
                :raw_choistats
              elsif filled_n_away && filled_n_away > 0
                :derived_seasonavgs
              else
                :zero_or_missing
              end

  # diag_prod: o que Rates.lambdas REALMENTE calcula em produção — recebe
  # `detail` (avgs cru, não o filled) e league_avgs sempre em branco/neutro.
  diag_prod = InstrumentedRates.diagnose(detail, league_avgs_blank)

  # contrafactual: e se Rates visse o avgs PREENCHIDO pelo SeasonAvgs (só
  # conserta o achado B, mantém o achado A — league sempre neutro)?
  diag_fill_fixed = InstrumentedRates.diagnose({ 'avgs' => filled_avgs }, league_avgs_blank)

  # contrafactual: e se a liga fosse corretamente propagada (só conserta o
  # achado A, mantém o achado B — Rates ainda lê avgs cru)?
  league_avgs_real = LeagueCalibration.baseline_for(row['league'].to_s, calibration)
  diag_league_fixed = InstrumentedRates.diagnose(detail, league_avgs_real)

  # contrafactual: os dois consertados.
  diag_both_fixed = InstrumentedRates.diagnose({ 'avgs' => filled_avgs }, league_avgs_real)

  sim = begin
    Runner.simulate(detail, n: mc_n, calibration: calibration)
  rescue StandardError => e
    { status: 'error', error: "#{e.class}: #{e.message}" }
  end

  status = sim[:status]
  p_home = sim[:p_home]
  p_draw = sim[:p_draw]
  p_away = sim[:p_away]

  prior_generico = status == 'pending' &&
                   approx?(p_home, 0.4424, 0.02) &&
                   approx?(p_draw, 0.2809, 0.02) &&
                   approx?(p_away, 0.2767, 0.02)

  exact_collapse = diag_prod[:ok] &&
                   approx?(diag_prod[:lambda_home], 1.50, 1e-6) &&
                   approx?(diag_prod[:lambda_away], 1.15, 1e-6)

  records << {
    id: row['id'], home: row['home_team'], away: row['away_team'], league: row['league'],
    status: status, p_home: p_home, p_draw: p_draw, p_away: p_away,
    prior_generico: prior_generico, exact_collapse: exact_collapse,
    usable_via_fill: usable,
    raw_n_home: raw_n_home, raw_n_away: raw_n_away,
    filled_n_home: filled_n_home, filled_n_away: filled_n_away,
    prov_home: prov_home, prov_away: prov_away,
    league_has_calibration: calibration.key?(row['league'].to_s),
    diag_prod: diag_prod, diag_fill_fixed: diag_fill_fixed,
    diag_league_fixed: diag_league_fixed, diag_both_fixed: diag_both_fixed
  }

  next unless ((i + 1) % 100).zero?

  elapsed = Time.now - t0
  STDERR.puts "[progress] #{i + 1}/#{rows_ok.size} em #{elapsed.round(1)}s (#{(elapsed / (i + 1)).round(3)}s/fixture)"
end

STDERR.puts "[info] instrumentação concluída em #{(Time.now - t0).round(1)}s"

File.write(File.expand_path('prior-generico-mecanismo.json', __dir__), JSON.pretty_generate(records))
STDERR.puts "[info] dump salvo em scripts/analysis/prior-generico-mecanismo.json (#{records.size} fixtures)"

conn.close
