# Propostas de melhorias e features — pesquisa de estado do sistema

**Data:** 2026-07-30 · **Método:** 2 agentes de varredura (pendências documentadas: 103 itens verificados contra o código de hoje; código órfão/UX: 11 áreas auditadas) + consultas read-only ao Postgres de produção. Nenhuma linha de código foi alterada — este doc é material de decisão do Pilot.

---

## O diagnóstico em uma frase

**O Abissal tem um motor de análise cada vez melhor acoplado a um produto que quase ninguém usa para apostar — e o elo entre os dois está quebrado em três lugares mensuráveis: entrega (a reco não chega onde o Pilot está), confiança (a IA decide com dados cegos) e aprendizado (o feedback humano é write-only).**

### Os números que sustentam isso (produção, 30/07)

| Métrica | Valor | Leitura |
|---|---|---|
| Recos geradas (total) | 1.088 (168 `verdict=bet`) | O motor produz todo dia |
| ROI hipotético das recos resolvidas | **+13,0%** (n=157, +3,12u / 24,08u) | O motor tem valor aparente |
| Apostas registradas na banca | 17 em mai → **0 em jun** → **3 em jul** | Ninguém segue o motor |
| Apostas com `ai_recommendation_id` | **0 de 20** | O elo reco→bet nunca foi usado |
| Feedback humano (`ai_reco_feedback`) | 12 linhas, e **nenhum consumidor** | Loop de aprendizado morto |
| OCR de bilhete (funil real) | 21 fotos → 14 falhas de parse → 3 commits | A ponte "aposta externa→banca" falha ~67% |
| Telemetria | 700 de 873 eventos são lixo de flood | A régua de UX está suja |
| CLV utilizável em julho | **5 pontos** (média −5,7%) | A métrica-guia do projeto está cega |
| Custo LLM em julho | US$ 0,47 (107 chamadas) | Custo NÃO é o problema; latência (p95 153s) é |
| Prompt do R1 | Placares `?-?` em 100% dos jogos | A IA decide sem nunca ver um placar |

---

## Proposta 1 — Fechar o loop reco→aposta via Telegram interativo ("o motor sem transmissão")

**O que é.** O épico Telegram já aprovado (Waves 2+3), com um recorte de produto específico: o alerta diário de recos (`send-reco-alerts.ts`, que já existe e já manda até 25 sugestões) ganha **inline keyboard** com `✅ Apostei · 👍 Concordo · 👎 Discordo`, respondido por um webhook `app/api/telegram/webhook` que chama os endpoints que **já existem** (`/api/ai-reco/apostei`, feedback). Comando `/analise <jogo>` dispara o compute.

**Por que é a proposta nº 1.** O funil hoje: 1.088 recos → 168 "bet" → **0 apostas vinculadas**. O elo (`/api/ai-reco/apostei`) está construído e bem feito — o problema é **onde** ele mora: dentro de um app que o Pilot abre cada vez menos (3 apostas em julho; bet_slips: 5 cancelados, 1 committed). O Telegram já entrega a reco no bolso às 07:45; hoje ela chega como texto morto e a ação exige abrir navegador, logar, achar o jogo. Cada toque de fricção mata o registro — e sem registro, `/calibracao` mede um sistema hipotético, o ROI realizado fica vazio, e a pergunta central do produto ("seguir a IA teria sido melhor?") fica sem resposta para sempre.

**Custo.** Médio: webhook + validação `X-Telegram-Bot-Api-Secret-Token` + 3 callbacks. O design já está decidido na memória do épico. Bloqueios reais: (a) @BotFather é tarefa do Pilot; (b) secrets em runtime no Worker via `wrangler secret put` (investigar como `/api/analyze` lia `OPENROUTER_API_KEY` — resolvido, o padrão existe).

**Reconsideração respeitosa (Pilot excluiu em 30/07, mas o contexto mudou):** o botão "✅ Apostei" — no app e no futuro webhook — não chama `checkDisciplinaLimits`, e a conta do irmão nasceu **sem nenhum limite** (guard falha aberto). Empurrar reco por Telegram sem guard amplifica exatamente o risco que a disciplina existe pra conter. Sugestão mínima que não reabre o épico dos guards: seedar `disciplina_settings` com defaults conservadores no signup (converte fail-open em fail-safe sem tocar o guard).

## Proposta 2 — Dar olhos à IA-2: consertar os dados do prompt (bug real encontrado)

**O que é.** Bump para `prompt-v1.2` corrigindo o que a varredura encontrou no prompt REAL de produção:

1. **Placares `?-?` em 100% dos jogos** — bug confirmado: `summarize_recent` (`ai_recommender_runner.rb:703`) lê `m['home_goals']`/`m['away_goals']`, mas o `WidgetMerger` grava `homeGoalsFt`/`awayGoalsFt`. O R1 recebe `W (?-?), L (?-?)...` desde sempre. O H2H (`summarize_h2h`) tem o mesmo bug — mostra `Time ?-? Time`.
2. **Premissa falsa** — `prompt_builder.rb:70` afirma "somente com edge >= 20% foram filtrados a montante", mas `EDGE_THRESHOLD = 10.0` desde a Wave R. O modelo raciocina acreditando que todo candidato tem o dobro do edge mínimo real.
3. **Confiança anti-informativa** — a análise de 28/07 mostrou: confiança "médio" (61% do volume) dá ROI −1,7%; "baixo" dá +42,9%. O campo `confidence` está pior que inútil — está invertido. Instrução de prompt + exibição precisam refletir isso (ou o campo sai do ranking).

**Por quê.** É a alavanca de maior retorno por linha: o recomendador toma ~50-100 decisões/dia com forma recente e H2H **sem nenhum placar** e com uma premissa numérica falsa. `prompt_version` já versiona tudo — o A/B retroativo v1.1 vs v1.2 sai de graça em `/calibracao`. Junto, no mesmo passe do runner: retry único para JSON truncado do R1 (falha silenciosa no batch = fixture sem reco no dia) e `read_timeout` no `OpenrouterClient` (uma call travada hoje gateia o lote inteiro).

**Custo.** Baixo. 2 funções Ruby + 1 linha de texto + espelho em `lib/ai-reco/prompts.ts` + specs. O retry/timeout é o follow-up já especificado em memória.

## Proposta 3 — CLV: consertar a régua e reformular o gate impossível

**O que é.** Três consertos + uma decisão:
- Capturar closing odds do **mercado+side da reco** para **todas** as recos (hoje só `verdict='bet'`, e das 56 capturas de julho só **5** casam mercado+side — CLV utilizável ≈ 5 pontos/mês).
- Popular `odd_taken` nas apostas manuais de `/bets/new` (P1 do backlog estratégico, "corrigir agora" há 2 meses — todas as 20 apostas reais estão fora do CLV).
- Widget de odds só cobre 1x2/over25/btts → aceitar e **medir CLV só onde é mensurável**.
- **Decisão:** o gate "CLV ≥ +1,5% em ≥300 bets" bloqueia as Waves B, C e O+E+P+R e é estruturalmente inalcançável no ritmo atual (~5 pontos/mês ⇒ ~5 anos). Reformular para algo alcançável (ex.: CLV 1x2-only, n≥100) ou trocar o gate dessas waves por outra evidência.

**Por quê.** O próprio CLAUDE.md chama o CLV de "métrica única que sobrevive a small-sample". Ela está cega, e três waves de produto estão presas atrás dela. Não é feature nova — é destravar o critério de decisão do projeto inteiro.

**Custo.** Baixo-médio (capture Ruby + UPDATE pós-RPC + decisão de gate que é só do Pilot).

## Proposta 4 — Painel "IA vs Pilot" + feedback que aprende

**O que é.** (a) Seção em `/calibracao` cruzando `ai_reco_feedback.user_decision` × `pl_units`: *quando o Pilot discorda da IA, quem tinha razão?* (b) Injetar os últimos N `disagree` + `comment` no prompt como few-shot de correção. (c) `user_id` + unicidade por usuário na tabela (hoje o irmão sobrescreve o feedback do Pilot).

**Por quê.** `agree`/`disagree` hoje é write-only puro — o clique grava e morre. É o único canal onde o julgamento humano entra no sistema, e é exatamente o dado que diferencia "ferramenta de análise" de "par que aprende comigo". Custa uma query (o painel) e um bloco de prompt (o few-shot). E honra a regra B24: não muda threshold nem modelo — só expõe evidência e contexto.

**Custo.** Baixo (painel) + baixo-médio (few-shot, com bump de `prompt_version` pra manter o A/B limpo).

## Proposta 5 — Análise on-demand honesta: assíncrona, idempotente, com cache

**O que é.** Transformar `POST /api/ai-reco/compute` de bloqueante em job assíncrono (202 + polling ou SSE de progresso), com: checagem de reco existente por `(fixture_id, prompt_version, model)` antes de pagar nova chamada (idempotência — hoje 5 cliques = 5 análises), e UI que diz a verdade ("te aviso quando ficar pronta" em vez de "~40s").

**Por quê.** O p95 real é 153s e o `maxDuration = 100` — **o request morre antes do percentil ruim por construção**. A telemetria confirma o vazamento: 49 cliques → 36 respostas (13 sumiram). E é o botão que o Pilot mais usa (49 cliques vs 1 `reco_viewed` nas recos automáticas) — as personas leram certo: o job real do usuário é *confirmação no momento do compromisso*, e a espera presa na tela é o maior vazamento de confiança do produto. Custo LLM não é argumento (US$ 0,47/mês); latência e perda silenciosa são.

**Custo.** Médio. Não ressuscitar `analysis_cache` — a chave natural já está em `ai_recommendations`.

## Proposta 6 — Wave "sinais vitais": o sistema não pode mais mentir que está saudável

**O que é.** Uma varredura única da classe "exit 0 não é saúde" (lição B41/B44, escrita mas nunca varrida):
- Scrape com 0 fixtures pinga **sucesso** no Healthchecks (token morto = silêncio total).
- `persister.rb` com `failed: 0` **hardcoded** — a métrica de saúde é uma constante.
- `Runner.simulate` engole `StandardError` sem log — foi o que escondeu o B50 por 4 semanas.
- Skeleton vazio sobrescreve `detail_json` bom (viola o invariante A5).
- Telemetria: rate-limit contornável já explorado (700/873 eventos são flood `"xxx…"`/`"spam"`) + retenção inexistente num Postgres free de 500 MB.
- E os dados que já existem e ninguém plota: **p50/p95 de `elapsed_ms`** (a métrica dos 153s está no banco há meses) e o **funil do OCR** (uploaded→parsed→committed — mede a acurácia do Gemini de graça; 14 falhas de parse, 3 ainda ontem).

**Por quê.** Três incidentes históricos (B41, B44, B50) são a mesma patologia: falha silenciosa vestida de verde. O projeto escreveu a lição três vezes; a varredura preventiva nunca aconteceu. Sem Sentry (excluído pelo Pilot), esses sinais são a única linha de defesa.

**Custo.** Médio, mas fatiável — cada item é independente e pequeno.

## Proposta 7 — Quick-wins de uma tarde (empacotados)

| # | Item | Evidência | Custo |
|---|---|---|---|
| 1 | Renomear `banca_snapshots`→`balance_snapshots` em 3 consumidores | Tabela fantasma: gráfico da banca morto, Kelly on-demand com banca fictícia de R$ 1.000, e a migration 0053 recém-aplicada desperdiçada | ~30 min |
| 2 | Cron diário `generate_balance_snapshots` + backfill | Sem ele, `/forecast` fica em "cedo demais" pra sempre e o snapshot só nasce quando uma aposta resolve | ~1h |
| 3 | `/forecast`: eixo por data (não por índice de linha) + `order desc` no limit | Slope "BRL/dia" hoje é BRL/dia-com-aposta | ~30 min |
| 4 | Destravar "+ bilhete" no card de oportunidades + `keyboard-help` | Bloqueio fantasma: "espera Wave M" — Wave M mergeada há 2 meses | ~15 min |
| 5 | Religar `DestaquesDoDia` no `/painel` | Feature completa (componente+action+tabela+view em prod) nunca importada | ~30 min |
| 6 | `Promise.all` em `/calibracao` (15 awaits seriais) e `fixtures/[id]` (22) + `loading.tsx` | Follow-up do B23 aberto desde 31/05; não existe um único `loading.tsx` no app | ~2h |
| 7 | p-valor invertido em `model-comparison.ts:68` | Veredito da arena pode ser lido ao contrário quando o champion vence | ~30 min |
| 8 | Logar OCR em `llm_request_logs` (`route='ocr'`) | Custo do Gemini invisível em `/llm-observability` | ~30 min |

## Proposta 8 — Motor e método: golden vector TS↔Ruby + gate OOS nos fitters irmãos

**O que é.** (a) Um arquivo de **golden vectors** compartilhado (JSON de entradas→saídas esperadas) consumido pelas duas suítes de `edge-calculator` (TS e Ruby) — hoje a paridade entre as duas implementações da mesma matemática é vigilância humana. (b) Estender o gate out-of-sample que o `fit-isotonic` ganhou em 29/07 para os irmãos `fit-temperature` e `fit-scoreline-cal`, que **ainda persistem parâmetros validados na própria amostra do fit** — a assinatura exata do walk-forward-bomb, a lição fundadora do projeto. (c) Escrita FORWARD dos challengers no scraper — sem ela a arena é indecidível (champion 10.122 predições em julho vs challenger 718; o checkpoint de 17/06 nunca pôde ser fechado).

**Por quê.** Quatro incidentes da mesma classe (B18/B19/B25/B43) vieram da dupla implementação sem contrato. E o projeto tem uma regra de ouro (evidência, nunca calendário) sendo violada semanalmente por dois crons não-assistidos. Isso não adiciona feature — blinda todas as existentes.

**Custo.** Baixo (golden vector, chamado pelo CTO das personas de "melhor custo/benefício da lista") + baixo (gates) + médio (forward write).

---

## Ideias de features novas (menor prioridade, registradas)

- **Re-scrape perto do KO** pegando carona no cron `closing-odds-capture` (15/17/19/21 UTC): sobe a cobertura de árbitro de ~4% (B38) e pega escalação oficial (ADR-006 Opção B). Destrava o challenger de cartões por árbitro (B47: dispersão varia por árbitro). Forward-only — cada semana sem semear é amostra perdida.
- **Reco no builder do bilhete** ("confirmação no momento do compromisso") — hipótese das personas §4, testável depois da P1.
- **`/explore` com o domínio análise** (`ai_recommendations`, `fixture_simulations`, `closing_odds`) + deep-link `?sql=` a partir do `/calibracao`.
- **Reavaliar gates vencidos:** F8 Bayesiano hierárquico e F14 GNN foram deferidos com 0 sims resolvidas; hoje há 3.508. O bump generativo de gols (viés de empate +3,1pp, 5/7 furos dos bilhetes RED) esperava "volta das ligas europeias" — a temporada nova chegou.

## O que só o Pilot pode decidir

1. Ordem/aprovação das propostas (recomendo: P7 quick-wins → P2 → P1 → P3 → P4 → P5 → P6 → P8).
2. @BotFather (bloqueia P1) e rotação do PAT Supabase + chave api-sports vazada (pendências de segurança desde maio).
3. Reformulação do gate de CLV (P3) — é decisão de método, não de código.
4. Reconsiderar o seed de `disciplina_settings` no signup (item excluído em 30/07; multi-usuário mudou o risco).

**Anexos (relatórios completos dos agentes):** 103 pendências verificadas + auditoria de 11 áreas de produto — disponíveis na transcript da sessão; posso materializá-los em `docs/pesquisas/` se quiser.
