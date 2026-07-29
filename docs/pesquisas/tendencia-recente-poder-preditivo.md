# A reta de tendência não prevê o lado do total

**Data:** 2026-07-29 · **Tipo:** achado negativo · **Status:** conclusivo para o escopo testado
**Reproduzir:** `pnpm exec tsx scripts/analysis/backtest-trend.ts`

## Pergunta

O painel "ÚLTIMOS JOGOS" (`components/fixtures/stats/panels/recent-matches.tsx`) desenha uma
reta tracejada de tendência sobre os últimos jogos de cada time — regressão linear via
`regression.linear`, linha 122. O Pilot usa essa reta na análise manual para decidir se entra
no **over** ou no **under** de uma linha.

A reta prevê alguma coisa?

A pergunta importa porque a resposta decide se ela vira um símbolo automático (`+`/`−`) ao
lado dos números da simulação, ou se continua sendo apenas descritiva.

## Por que a pergunta não é circular

A simulação usa **força de temporada** — os blocos `*Avgs` do choistats, com `numMatches`
entre 17 e 37 (ADR-006). Ela consome o **nível** médio do time e é cega para a **direção**
recente. Um time que fazia 2 gols e passou a fazer 0 entra no modelo com a mesma média de
sempre.

Ou seja: a tendência é informação que o modelo genuinamente não tem. Não é a saída da
simulação comparada com a entrada dela. Se tivesse poder preditivo, seria sinal novo.

## Método

**Fonte:** `fixtures.detail_json->recent_matches` — os últimos jogos de cada time, com
`homeCorners`/`awayCorners`, `homeYellows`/`awayYellows`, `homeShotsOnTarget`/`awayShotsOnTarget`
e `homeGoalsFt`/`awayGoalsFt`. É a **mesma fonte que alimenta o gráfico**, com séries
contínuas — não a base reconciliada de `fixture_simulations`, que tem buracos (mediana de 4
jogos por time) e produziria uma reta diferente da que aparece na tela.

**Amostra:** 748 fixtures vivas → 8.917 jogos históricos únicos (dedup por `id`), 1.225 times,
mediana de 16 jogos por time.

**Walk-forward, sem leakage:** para cada jogo histórico J em que ambos os times têm ≥ K jogos
**anteriores** a J, computa-se a inclinação dos K anteriores de cada lado, soma-se, e testa-se
contra o total real de J. Nada posterior a J entra na conta.

**Linha de referência:** mediana observada do total naquela liga + 0.5.

**Baseline:** "chutar sempre o lado majoritário". Este é o ponto metodológico central — ver
abaixo.

### O baseline é o que faz o teste valer

Em contagem discreta o lado *under* costuma ser majoritário (a mediana + 0.5 joga a massa
da própria mediana para baixo). Comparar contra 50% faz qualquer estratégia enviesada para
o under parecer competente. Foi exatamente assim que uma primeira rodada deste teste produziu
um resultado sedutor e falso:

```
cartões   tendência ALTA  n=72   31.9%      ← "a tendência alta erra!"
          tendência BAIXA n=108  66.7%      ← "a tendência baixa acerta!"
```

Não havia sinal nenhum ali: a taxa-base de under em cartões é ~59%, e a "tendência baixa"
apenas concordava com o lado mais provável por acaso. A assimetria era o viés da linha, não
a reta funcionando.

É a mesma armadilha do backtest da IA-2 de 2026-05-25 ([walk-forward-bomb], `docs/superpowers/specs/2026-05-25-backtest-walk-forward.md`):
+14% in-sample virou −14% out-of-sample.

## Resultado

40 células testadas — 4 métricas × 2 janelas (6 e 10 jogos) × 5 cortes de força da inclinação
(todas, top 50%, top 25%, top 10%, top 5%).

**Janela de 6 jogos, todas as chamadas:**

| métrica | chamadas | acerto | taxa-base | lift |
|---|---:|---:|---:|---:|
| gols | 3.395 | 51,2% | 61,8% | **−10,7pp** |
| escanteios | 4.331 | 50,7% | 56,1% | **−5,4pp** |
| cartões | 3.718 | 50,6% | 58,8% | **−8,1pp** |
| finalizações | 4.208 | 50,1% | 55,3% | **−5,2pp** |

**Janela de 10 jogos, por corte de força** (a hipótese de que a reta só vale quando é gritante):

| métrica | corte | n | acerto | IC95 | lift |
|---|---|---:|---:|---|---:|
| gols | top 25% | 779 | 55,5% | 51,9%–58,9% | −5,5pp |
| gols | top 5% | 157 | 51,0% | 43,2%–58,7% | −10,0pp |
| escanteios | top 10% | 312 | 52,9% | 47,3%–58,4% | −3,9pp |
| cartões | top 5% | 162 | 46,9% | 39,4%–54,6% | −11,9pp |
| finalizações | top 10% | 313 | 55,9% | 50,4%–61,3% | **+1,6pp** |

Agregando as 40 células:

- acerto entre **46,9% e 55,9%**
- IC95 cruzando 50% em praticamente todas
- lift **negativo em 39 de 40**
- a única positiva (+1,6pp) é 1 em 40 — o que o acaso produz nesse número de testes

**Variante testada em separado** — a reta do time prevendo o número *dele próprio* no jogo
seguinte, que é o uso literal do gráfico: 49,8% a 51,5%, lift de −14,3pp a +0,7pp.

## Conclusão

A reta de tendência, **isolada**, não prevê o lado do total. Com ~4.000 chamadas por métrica,
um efeito de 3 pontos teria aparecido (σ ≈ 0,8pp).

**Decisão:** não promover a reta a sinal automático. O gráfico "ÚLTIMOS JOGOS" permanece na
tela como descritivo — ver o que aconteceu é legítimo. O que fica descartado é o `+`/`−`
derivado dela e o plano de persistir a inclinação por semanas para medir forward: a medição
forward custaria 3 semanas para detectar um efeito de 10pp e ~3 meses para um de 5pp, e este
teste já cobre o mesmo terreno com amostra maior.

## O que este teste NÃO refuta

Escopo honesto do achado:

1. **A reta combinada com contexto humano.** O Pilot lê a tendência junto com desfalque,
   calendário e adversário. O teste isola a reta; não mede o julgamento em volta dela.
2. **Outras formulações de forma recente** — médias móveis exponenciais, forma ponderada por
   qualidade do adversário, ou tendência condicionada a mando de campo. Só a inclinação da
   regressão linear simples foi testada, porque é o que o gráfico desenha.
3. **A tendência como filtro de confiança** sobre um sinal que já funciona (ex.: só apostar
   quando a simulação e a tendência concordam). Não testado — mas se a reta é ruído, a
   concordância tende a não agregar.

Se alguma dessas for retomada, o script aceita `--window` e `--metric` e o baseline já está
embutido. Refazer o teste sem o baseline de lado majoritário é reintroduzir a armadilha.

## Relacionado

- ADR-006 — simulação usa força de temporada (o *porquê* de a tendência ser informação nova)
- `docs/superpowers/specs/2026-07-29-desempenho-modelo-por-liga-design.md` — o spec que este
  achado podou
- Lição B24 — mudança de sinal/prompt/threshold só por evidência, nunca por calendário
