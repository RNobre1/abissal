---
name: bilhete
description: Monta bilhete(s) de aposta (múltipla) a partir da NOSSA simulação calibrada × odds da casa + guardrails de calibração (fade dos mercados onde a IA erra). Use quando o Pilot pedir "monta um bilhete", "bilhete de odd X", "cria uma múltipla", "value bets de hoje/da semana", "aposta pros jogos de [dia]". Variáveis do Pilot: DIAS (data ou intervalo), ODD alvo (combinada), Nº DE JOGOS (pernas), LIGAS (filtro). Read-only sobre prod; só lê dados, nunca aposta.
---

# Skill: bilhete — caça-valor próprio + fade da calibração

Codifica o método que o Pilot validou no chat: pra **todos** os jogos (não só os
que a IA-2 apostou), comparar a **probabilidade da simulação calibrada** (mesma
isotônica da IA) contra a **odd da casa**, aplicar os **guardrails da calibração**
(confiar onde a IA acerta; **apostar no inverso (fade)** onde ela erra de forma
consistente; **nunca** apostar nos mercados condenados), e montar um bilhete que
bata a **odd alvo** do Pilot.

## Variáveis do Pilot (extrair do pedido; aplicar defaults)
- **DIAS** — `--date YYYY-MM-DD` (default: hoje UTC). Intervalo: `--to YYYY-MM-DD`. "essa semana" = hoje→domingo; "fim de semana" = sáb→dom; "próximos N dias" = hoje→hoje+(N-1).
- **ODD alvo** — odd combinada do bilhete (ex.: 20, 100). Sem alvo → proponha 2 bilhetes (~20 e ~100). Aceite ±15% do alvo (explique se não fechar exato).
- **Nº DE JOGOS** — nº de pernas. Sem valor → use o mínimo de pernas que atinge a odd com qualidade.
- **LIGAS** — `--ligas "serie b,liga pro"` (substring, CSV). Sem valor → todas.

## Passos

1. **Candidatos (value-bets).** Da raiz `scripts/scraper`:
   ```bash
   export DATABASE_URL="$(grep -m1 '^DATABASE_URL=' ../../.env.local | cut -d= -f2-)"
   mise exec -- bundle exec ruby bin/value_bets --date <DIA> [--to <FIM>] [--ligas "<L>"] --min-edge 0.05
   ```
   Saída: **CANDIDATOS** (edge≥5%, mercado permitido, com tag de confiabilidade) + **ARMADILHAS** (edge alto mas mercado condenado — **proibido usar**). Tags:
   - `trust` = histórico +ROI (1x2 casa/fora). `trust_inverse` = **fade** de mercado ruim (ex.: Over 2.5 porque a IA é péssima no under) — confiável. `weak` = amostra pequena (use com cautela). `unknown` = sem referência.
2. **(Opcional) Cruzar com os scans** pra contexto/pernas extras, da raiz do repo:
   ```bash
   pnpm exec tsx scripts/analysis/pre-match-scan.ts --metric duplo-green --date <DIA> [--to <FIM>] --upcoming
   pnpm exec tsx scripts/analysis/pre-match-scan.ts --metric corners     --date <DIA> [--to <FIM>] --upcoming
   ```
3. **Montar o bilhete** (seu julgamento):
   - Use SÓ os **CANDIDATOS**. **Nunca** as ARMADILHAS.
   - Prioridade: `trust` / `trust_inverse` > `weak` > `unknown`. A perna mais sólida do dia costuma ser **SOT-under** e **Over 2.5** (fade).
   - **Uma perna por jogo** (múltipla válida — pernas do MESMO jogo são correlacionadas e a casa bloqueia).
   - Escolha o conjunto cuja **odd combinada (produto)** ≈ ODD alvo, com `Nº DE JOGOS` pernas (ou o mínimo que atinge a odd).
4. **Reportar honesto** (tabela): por perna → jogo, KO UTC, aposta, odd, `p` calibrada, tag. Depois: **odd combinada**, **prob combinada** (produto das `p`), **% realista de bater**, e o aviso de variância (múltipla = alta variância; amostras pequenas; stake pequeno; não é "valor garantido"). Diga qual perna você realmente confia.
5. **Registrar (se o Pilot for apostar):** salve em `docs/apostas/<DIA>.md` (método + tabela do bilhete + placeholder de RESULTADOS pra conferir depois). Veja `docs/apostas/2026-06-01.md` como modelo.

## Princípios inegociáveis
- **Fade só vale com folga:** mercado onde a IA erra MUITO (over25-under 6%, empate 0%) → inverso é forte. Perto de 50% (corners-under-8.5 46%) → fade é ~neutro, não force.
- **Nunca** apostar `avoid`/`avoid_inverse` (over25-under, btts-não, empate) mesmo com edge alto — é exatamente onde o modelo se engana.
- É **display/decisão-do-Pilot**, não recomendação automática da IA-2 do sistema. Stake é do Pilot.
- Honestidade > venda: mostre a prob real (~baixa em múltiplas altas) e a fragilidade de amostra.
