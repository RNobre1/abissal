# Bump generativo de gols (conserto do viés de empate) — como CHALLENGER da arena

> Criado 2026-06-09 a partir de B39 (bilhetes 01-02/06 todos RED; 5 dos 7 furos
> de pernas 1x2-vencedor foram EMPATE). Status: **GATED — aguardando volta das
> ligas europeias** (volume atual de jogos é baixo demais pra fit/veredito; IA
> também está desligada até lá, decisão do Pilot 2026-06-09).

## Problema

A sim v7 subestima empate de forma medida e persistente:

- **B33 (medição, n=882):** empate real 26.8% vs previsto 23.7% (**+3.1pp**);
  superconfiança no placar modal (top-1 previa 14.7%, crava 10.2%).
- **B28 (diagnóstico):** médias de gol corretas (2.72≈2.72) e ρ DC normal
  (−0.077) — o problema é a **forma** da distribuição conjunta de gols
  (correlação/dispersão), não a média.
- **B39 (prejuízo real):** pernas 1x2-vencedor 2/9 na semana 01-07/06; a
  calibração isotônica 1x2 não salva porque o teto da curva gera p≈0.86
  superconfiante em liga pequena.

A `scoreline-cal` (B33, T=1.40/δ=0.90) é **display-only** — conserta a forma do
top-6 exibido, mas NÃO toca `p_home/p_draw/p_away` nem o que alimenta
edge-calc/bilhete. O viés segue vazando pra toda superfície de aposta.

## Por que challenger, e não patch no champion

- **B28/B24:** mexer no gerador = bump de `model_version` → reseta TODAS as
  curvas de calibração (isotônica, league_parameters, dist-k) + não há backtest
  (detail_json purgado em ~4 dias). Custo alto, evidência a priori zero.
- **ADR-011/B37:** a arena existe exatamente pra isso — challenger roda em
  shadow (`model_predictions`), walk-forward, cobertura total, bootstrap
  pareado deflacionado, e SÓ promove com log-loss↓ E reliability-não-pior.
- **B35/B36/B37 (lição da 1ª rodada):** a intuição importada ("CMP pra cartões")
  morreu na comparação justa. Este challenger nasce já no esquema justo.

## Candidatos de challenger (mercado `1x2` + `scoreline`)

Em ordem de simplicidade; cada um é um challenger separado na arena:

1. **`challenger-1x2-dc-rho-fit`** — Dixon-Coles com ρ fitado walk-forward nos
   NOSSOS dados (hoje ρ é prior calibrável via league_parameters, mas o efeito
   medido em B28 era "DC não mexe o suficiente no empate"). Barato: só re-score
   das probs 1x2 a partir das médias já persistidas, mesmo esquema do
   `walk-forward.ts` existente.
2. **`challenger-goals-negbin`** — gols por time via Negative Binomial (em vez
   de Poisson+DC), `r` walk-forward (reusa `negbin.ts`/`fitCountR` de B36).
   Over-dispersão de gols achata o modal e engorda placares vizinhos (inclui
   empates). Score via grid de placar → p_home/draw/away + log-loss de
   scoreline.
3. **`challenger-1x2-draw-inflated`** — bivariate Poisson / zero-um-inflado no
   empate (literatura: Karlis-Ntzoufras). Mais paramétrico; só se 1 e 2
   falharem.

## Esquema de avaliação (igual B37 — inegociável)

- Walk-forward cronológico, cobertura total nos dois lados (champion v7 incluso).
- Árbitro: **log-loss** no mercado `1x2` (e `scoreline` como secundário).
- Bootstrap pareado com deflação pelo nº de challengers ativos.
- Métrica de honestidade extra: **calibração do empate** (previsto vs real em
  bins) — o challenger tem que fechar o gap de +3.1pp, não só ganhar no
  agregado.
- Veredito no card `/calibracao` + checkpoint humano (como o de 17/06 do CMP).

## Gates

- [ ] Ligas europeias de volta (volume ≥ ~100 jogos/semana reconciliados).
- [ ] Checkpoint do challenger CMP-cards (17/06) concluído — não acumular 2
      vereditos pendentes na arena ao mesmo tempo.
- [ ] Seed/score implementado com TDD (mesmo padrão de
      `seed-challenger-cards-cmp.ts` + `lib/calibracao/*.test.ts`).

## Não-escopo

- NÃO mexer no prompt/threshold da IA-2 (B24).
- NÃO bumpar model_version do champion antes de veredito da arena.
- NÃO expandir superfície de aposta com probs do challenger (shadow = shadow).
