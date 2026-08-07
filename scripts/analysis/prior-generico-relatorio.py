#!/usr/bin/env python3
"""
Pós-processamento do dump scripts/analysis/prior-generico-mecanismo.json
(gerado pelo instrumentador Ruby, somente leitura) — responde as 5
perguntas do ticket T3. Não altera nenhum artefato de produção.
"""
import json
import math
from collections import Counter, defaultdict

with open("prior-generico-mecanismo.json") as f:
    recs = json.load(f)

print(f"=== total identidade completa instrumentadas: {len(recs)} ===\n")

status_counts = Counter(r["status"] for r in recs)
print("status:", dict(status_counts))

pending = [r for r in recs if r["status"] == "pending"]
prior_generico = [r for r in pending if r["prior_generico"]]
simulacao_boa = [r for r in pending if not r["prior_generico"]]
unsimulable = [r for r in recs if r["status"] == "unsimulable"]

print(f"prior genérico (±0.02 MC n=10000): {len(prior_generico)}")
print(f"simulação boa: {len(simulacao_boa)}")
print(f"unsimulable: {len(unsimulable)}")
print()

# --- Pergunta 1: colapso exato vs pouco informativo -------------------------
print("=" * 70)
print("PERGUNTA 1 — colapso EXATO (lambda=1.50/1.15 cravado) vs pouco informativo")
print("=" * 70)

exact_in_pg = [r for r in prior_generico if r["exact_collapse"]]
near_in_pg = [r for r in prior_generico if not r["exact_collapse"]]
print(f"Dos {len(prior_generico)} 'prior genérico' (MC, ±0.02):")
print(f"  colapso EXATO em lambda (w=0 dos dois lados):  {len(exact_in_pg)}")
print(f"  NÃO colapso exato (apenas caiu na janela ±0.02 por ruído/parcial): {len(near_in_pg)}")

exact_all = [r for r in pending if r["exact_collapse"]]
exact_but_not_pg = [r for r in exact_all if not r["prior_generico"]]
print(f"\nTotal de colapso EXATO em lambda entre TODAS as pending: {len(exact_all)}")
print(f"  desses, caíram fora da janela ±0.02 por ruído do MC (n=10000): {len(exact_but_not_pg)}")
if exact_but_not_pg:
    diffs = [abs(r["p_home"] - 0.4424) for r in exact_but_not_pg]
    print(f"  desvio médio em p_home nesses casos: {sum(diffs)/len(diffs):.4f} (max {max(diffs):.4f})")

# --- Pergunta 2: proveniência do num_matches --------------------------------
print()
print("=" * 70)
print("PERGUNTA 2 — proveniência do num_matches (raw choistats / SeasonAvgs / zero)")
print("=" * 70)


def prov_pair(r):
    return (r["prov_home"], r["prov_away"])


print("Distribuição em TODAS as 331 prior genérico (lado casa, lado fora):")
ph = Counter(r["prov_home"] for r in prior_generico)
pa = Counter(r["prov_away"] for r in prior_generico)
print(f"  home: {dict(ph)}")
print(f"  away: {dict(pa)}")

print("\nCruzamento completo (home_prov, away_prov) nas 331:")
pair_counts = Counter(prov_pair(r) for r in prior_generico)
for k, v in sorted(pair_counts.items(), key=lambda x: -x[1]):
    print(f"  {k}: {v}")

# quantas tinham SeasonAvgs.fill com dado disponível (derived) em pelo menos
# um lado, mas mesmo assim colapsaram exatamente — o preço do achado B
wasted_fill = [
    r for r in exact_all
    if r["prov_home"] == "derived_seasonavgs" or r["prov_away"] == "derived_seasonavgs"
]
print(f"\nColapso EXATO onde SeasonAvgs.fill TINHA dado reconstruível em pelo menos"
      f" um lado (derived_seasonavgs) mas Rates.lambdas nunca viu (achado B): {len(wasted_fill)}")
wasted_both = [
    r for r in exact_all
    if r["prov_home"] == "derived_seasonavgs" and r["prov_away"] == "derived_seasonavgs"
]
print(f"  nos dois lados: {len(wasted_both)}")
zero_both = [
    r for r in exact_all
    if r["prov_home"] == "zero_or_missing" and r["prov_away"] == "zero_or_missing"
]
print(f"  ambos os lados genuinamente sem série (zero_or_missing, nem o fill teria dado): {len(zero_both)}")
raw_small_both = [
    r for r in exact_all
    if r["prov_home"] == "raw_choistats" and r["prov_away"] == "raw_choistats"
]
print(f"  ambos com raw_choistats (n pequeno mas real, não degenerado — n>=1<15 nos dois): {len(raw_small_both)}")

# --- Pergunta 3: qual causa domina (w->0 vs baseline neutro) ---------------
print()
print("=" * 70)
print("PERGUNTA 3 — w→0 (shrinkage) vs baseline neutro: decomposição via contrafactuais")
print("=" * 70)

league_calibrated_count = sum(1 for r in pending if r["league_has_calibration"])
print(f"Fixtures (pending) cuja LIGA REAL tem league_parameters calibrado: "
      f"{league_calibrated_count} / {len(pending)}")
pg_calibrated = sum(1 for r in prior_generico if r["league_has_calibration"])
print(f"Dentre as 331 prior genérico, quantas são de liga calibrada: {pg_calibrated}")

print("\nAchado A confirmado: detail_json NUNCA tem a chave 'league' (0/1104 no banco).")
print("Runner.simulate sempre lê league='' -> LeagueCalibration.baseline_for cai")
print("SEMPRE em NEUTRAL_BASELINE / DEFAULT_RHO, mesmo para as 29 ligas calibradas.")
print("Ou seja: a causa 'baseline neutro' não VARIA por fixture — é constante (100%).")
print("A única coisa que varia de fixture pra fixture é o shrinkage (w).\n")


def collapses(diag, eps=1e-6):
    return diag.get("ok") and abs(diag["lambda_home"] - 1.50) <= eps and abs(diag["lambda_away"] - 1.15) <= eps


fix_fill_only = 0
fix_league_only = 0
fix_both_needed = 0
still_collapsed_both_fixed = 0
for r in exact_all:
    fill_avoids = not collapses(r["diag_fill_fixed"])
    league_avoids = not collapses(r["diag_league_fixed"])
    both_avoids = not collapses(r["diag_both_fixed"])
    if fill_avoids:
        fix_fill_only += 1
    if league_avoids:
        fix_league_only += 1
    if both_avoids and not fill_avoids and not league_avoids:
        fix_both_needed += 1
    if not both_avoids:
        still_collapsed_both_fixed += 1

print(f"Dos {len(exact_all)} colapsos EXATOS:")
print(f"  consertar SÓ o achado B (fill->Rates) já evitaria o colapso em: {fix_fill_only}")
print(f"  consertar SÓ o achado A (league sempre '') já evitaria o colapso em: {fix_league_only}")
print(f"  só evitam o colapso se os DOIS forem consertados JUNTOS: {fix_both_needed}")
print(f"  continuam colapsando MESMO com os dois consertados (falta de dado real): {still_collapsed_both_fixed}")

# --- Pergunta 4: discriminante barato + ROC ---------------------------------
print()
print("=" * 70)
print("PERGUNTA 4 — discriminante barato: min(n_home, n_away) e distância de lambda")
print("=" * 70)

labeled = [(r, r["prior_generico"]) for r in pending]


def min_n(r):
    nh = r["raw_n_home"]
    na = r["raw_n_away"]
    vals = [v for v in (nh, na) if v is not None]
    if nh is None or na is None:
        return -1  # ausência é PIOR que zero — sentinela abaixo de qualquer n observado
    return min(nh, na)


def lambda_dist(r):
    d = r["diag_prod"]
    if not d.get("ok"):
        return None
    return math.sqrt((d["lambda_home"] - 1.50) ** 2 + (d["lambda_away"] - 1.15) ** 2)


def roc(signal_fn, labeled, ascending=True):
    """Sinal ascendente = quanto MENOR, mais suspeito de prior genérico."""
    pts = [(signal_fn(r), y) for r, y in labeled]
    pts = [(s, y) for s, y in pts if s is not None]
    pts.sort(key=lambda x: x[0], reverse=not ascending)
    P = sum(1 for _, y in pts if y)
    N = sum(1 for _, y in pts if not y)
    tp = fp = 0
    roc_pts = [(0.0, 0.0)]
    prev_s = None
    for s, y in pts:
        if y:
            tp += 1
        else:
            fp += 1
        if s != prev_s:
            roc_pts.append((fp / N if N else 0, tp / P if P else 0))
            prev_s = s
    roc_pts.append((1.0, 1.0))
    # AUC trapezoidal
    auc = 0.0
    for i in range(1, len(roc_pts)):
        x0, y0 = roc_pts[i - 1]
        x1, y1 = roc_pts[i]
        auc += (x1 - x0) * (y0 + y1) / 2
    return roc_pts, auc, P, N


roc_minn, auc_minn, P, N = roc(min_n, labeled, ascending=True)
roc_dist, auc_dist, _, _ = roc(lambda_dist, labeled, ascending=True)

print(f"Universo do ROC: {P} positivos (prior genérico) / {N} negativos (simulação boa), pending={len(pending)}")
print(f"\nAUC min(n_home, n_away): {auc_minn:.4f}")
print(f"AUC distância de lambda a (1.50,1.15): {auc_dist:.4f}")

print("\nCurva ROC — min(n_home,n_away) — pontos (FPR, TPR) amostrados:")
step = max(1, len(roc_minn) // 20)
for i in range(0, len(roc_minn), step):
    print(f"  FPR={roc_minn[i][0]:.3f} TPR={roc_minn[i][1]:.3f}")

print("\nCurva ROC — distância de lambda — pontos (FPR, TPR) amostrados:")
step = max(1, len(roc_dist) // 20)
for i in range(0, len(roc_dist), step):
    print(f"  FPR={roc_dist[i][0]:.3f} TPR={roc_dist[i][1]:.3f}")

# preço de alguns cortes concretos de min_n (para a seção de opções)
print("\nPreço de cortes concretos em min(n_home, n_away) < k (barra a simulação):")
for k in [1, 2, 3, 5, 8, 15]:
    barred = [r for r, y in labeled if (min_n(r) < k)]
    barred_pg = [r for r in barred if r["prior_generico"]]
    barred_good = [r for r in barred if not r["prior_generico"]]
    print(f"  k={k:>2}: barra {len(barred):>4} fixtures total "
          f"({len(barred_pg)} prior-genérico corretamente barradas, "
          f"{len(barred_good)} simulação-boa descartada por engano)")

# --- Pergunta 5: bug de perspectiva no SeasonAvgs.derive --------------------
print()
print("=" * 70)
print("PERGUNTA 5 — bug de perspectiva em SeasonAvgs.derive: ver verificação separada")
print("=" * 70)
print("(checado à parte contra 400 fixtures reais via recent_matches; ver relatório)")

# --- dump extra: fixtures onde o achado B teria feito diferença real -------
print()
print("=" * 70)
print("Amostra de fixtures onde SÓ o achado B (fill->Rates) resolveria o colapso")
print("=" * 70)
sample = [r for r in exact_all if not collapses(r["diag_fill_fixed"])][:10]
for r in sample:
    print(f"  {r['id']} {r['home']} x {r['away']} [{r['league']}] "
          f"raw_n=({r['raw_n_home']},{r['raw_n_away']}) "
          f"filled_n=({r['filled_n_home']},{r['filled_n_away']}) "
          f"fill_fixed_lambda=({r['diag_fill_fixed']['lambda_home']:.3f},{r['diag_fill_fixed']['lambda_away']:.3f})")
