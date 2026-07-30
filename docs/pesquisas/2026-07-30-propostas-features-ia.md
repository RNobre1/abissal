# Features novas de IA para o usuário final — rodada 2

**Data:** 2026-07-30 (noite, pós-merge do PR #63) · **Premissa do Pilot:** features NOVAS que usam IA e que o usuário final (Pilot + irmão) usa de fato — não plumbing interno.

**Três fatos que mudam o cálculo de qualquer feature de IA aqui:**
1. **Custo não é restrição:** julho inteiro custou US$ 0,47 de LLM (107 chamadas). Dá pra ser generoso.
2. **A infra difícil já existe:** streaming SSE sem timeout no Worker (ADR-002), tool-loop com auditoria já rodou em prod (`/api/copilot`, aposentado), `prompt_version` versiona tudo (A/B grátis), kill switch global cobre qualquer feature nova de graça.
3. **O que o usuário FAZ (telemetria real):** clica "pedir análise" (49×), tenta OCR (21×, 14 falhas), ignora recos automáticas (1 visualização). O apetite é por **interação no momento da decisão**, não por mais dashboards.

---

## F1 — "Pergunte ao jogo": chat copiloto na página do fixture ⭐

**O que é.** Um FAB/drawer na página do jogo com chat em streaming. Por trás, tool-loop: o modelo tem 12 ferramentas que consultam os dados REAIS do jogo (forma, H2H, streaks, simulação, odds, insights derivados) e cada chamada de tool aparece como chip no chat (transparência total, auditada em `llm_request_logs`).

**Como se usa.** Abre o jogo, pergunta: *"por que o under tá pagando 2.6 aqui?"*, *"esse time sofre escanteio no 2º tempo?"*, *"a reco de hoje faz sentido com o desfalque X?"*. Resposta em streaming citando os números que a tool devolveu — não alucinação.

**Por que vai funcionar (evidência).** (a) O plano COMPLETO já está escrito em `docs/tasks/fixture-copilot-stats-first/00-plan.md` — endpoint, 12 tools, drawer, testes, e2e — 100% dos checkboxes abertos; a demolição (aposentar `/api/analyze`) foi executada e a construção nunca veio. (b) A fundação existe e é testada: as tools são wrappers finos sobre `lib/fixtures/stats/derive.ts`/`insights.ts` (funções puras com suíte própria). (c) O tool-loop é padrão comprovado no próprio repo (`/api/copilot` antigo). (d) 49 cliques em "pedir análise" = o usuário JÁ quer conversar com o jogo; hoje ele recebe um bloco fixo de texto e não pode perguntar nada de volta. **Custo:** DeepSeek v3.2, centavos/mês. **Risco:** médio-baixo — o plano mitiga o risco clássico (payload no Worker) escopando tools ao `detail_json` de UM fixture.

## F2 — Advogado do diabo do bilhete

**O que é.** Botão "criticar bilhete" no builder e no commit do slip (incluindo bilhete importado por foto): a IA analisa cada perna contra a simulação calibrada + o histórico de acerto POR MERCADO (`market-accuracy`) + correlação entre pernas, e devolve veredicto por perna + veredicto do bilhete.

**Como se usa.** Montou a múltipla (ou fotografou o cupom da Superbet), toca "criticar": *"Perna 2 (1x2 casa): o mercado onde nosso modelo mais erra é exatamente o empate — 26,8% real vs 23,7% previsto; essa odd 2.1 não cobre. Perna 3: OK, edge +6% calibrado. Bilhete: EV combinado negativo — trocar a perna 2 por dupla chance paga mais."*

**Por que vai funcionar (evidência).** Os bilhetes de 01-02/06 foram TODOS red, com 5 de 7 furos em pernas 1x2 por empate — e a resposta na época foi um guardrail *na skill do Claude* (`bilhete`: máx 1 perna 1x2, nunca âncora). Ou seja: **a inteligência já existe, mas só funciona quando o Pilot fala comigo no terminal**. Essa feature põe o mesmo guardrail dentro do produto, no momento do compromisso — que é exatamente onde as personas concluíram que a IA deveria estar ("confirmação no momento do compromisso", a hipótese do §4). O irmão, que nunca vai abrir o Claude Code, ganha a mesma proteção. **Custo:** 1 chamada por crítica. **Risco:** baixo — leitura pura, não bloqueia nada (disciplina continua sendo outro assunto).

## F3 — Perguntas em linguagem natural no /explore (NL→SQL local)

**O que é.** Campo de pergunta livre no `/explore`: a IA traduz *"quanto perdi em corners-under em julho, por casa?"* em SQL DuckDB, roda **no navegador** (DuckDB-WASM já carrega os dados reais), mostra a query gerada (editável) + o resultado.

**Por que vai funcionar (evidência).** O `/explore` existe, funciona, e exige SQL manual — fricção máxima, uso ~zero. NL→SQL é o caso de uso onde LLMs são comprovadamente fortes com schema pequeno e conhecido (4-7 tabelas). Os dados **nunca saem do navegador** — o LLM só vê o schema e a pergunta, roda-se localmente. E com a expansão do dataset pro domínio análise (`ai_recommendations`, `fixture_simulations`, `closing_odds` — proposta da rodada 1), vira a ferramenta de resposta de QUALQUER pergunta sobre o próprio desempenho. **Custo:** ~US$ 0,001/pergunta. **Risco:** baixo (query roda local, read-only, mostrada antes de rodar).

## F4 — Briefing matinal ("Abissal Daily")

**O que é.** Todo dia após o cron da IA-2 (10:45 UTC), um texto de 1 minuto de leitura gerado por LLM que CONECTA os dados do dia: as recos com contexto ("3 oportunidades, mas 2 em ligas não-calibradas — o histórico nelas é −8%"), o estado da banca, o que resolver de ontem. Exibido no topo do `/painel`; quando o Telegram interativo sair, vira a mensagem das 07:45.

**Por que vai funcionar (evidência).** O `send-reco-alerts` já manda até 25 recos como lista crua — informação sem narrativa. O painel tem os dados espalhados em 6 telas. O usuário real abre o app de manhã com UMA pergunta ("o que tem pra hoje?") e hoje precisa montar a resposta sozinho. Um parágrafo bem escrito é a interface de menor fricção que existe. **Custo:** 1 chamada/dia. **Risco:** quase zero — é leitura, e o A/B de qualidade sai via `prompt_version`.

## F5 — Post-mortem automático de aposta

**O que é.** Quando uma aposta resolve, a IA gera 2-3 linhas persistidas na bet: o que a simulação dizia, o que aconteceu, e o veredicto honesto — *"variância normal (a sim dava 38% pro seu lado — perder 62% das vezes é esperado)"* vs *"a tese ignorou que esse mercado é o pior do modelo"*. Aparece em `/bets` e alimenta o futuro painel IA vs Pilot.

**Por que vai funcionar (evidência).** Hoje uma aposta resolvida não ensina NADA — vira uma linha no ledger. O campo `thesis` existe justamente pra aprendizado e está morto (0 de 20 apostas). O post-mortem é o fechamento do ciclo que a disciplina do produto promete: aposta → resultado → **lição**. É também a feature que diferencia o Abissal de qualquer planilha: a planilha registra, o Abissal explica. **Custo:** 1 chamada por resolução (~3-30/mês). **Risco:** zero — assíncrono, best-effort.

## F6 — OCR que conversa quando falha

**O que é.** Quando o parse da foto falha (66% das tentativas!), em vez do beco sem saída "tenta uma foto mais clara", abre um campo: *"me diz o que tá no cupom (times, mercado, odd, valor)"* — o usuário digita livre, a MESMA pipeline estrutura as legs e segue pro fuzzy-match normal.

**Por que vai funcionar (evidência).** Funil real: 21 fotos → 14 falhas → 3 commits, com falhas ainda ontem (29/07). Cada falha hoje é um usuário que desiste (o irmão, provavelmente). Texto livre é um problema MUITO mais fácil pro LLM que visão em foto amassada de cupom — a taxa de recuperação deve ser ~100%. E o custo de construção é baixo: o schema de saída, o fuzzy-match e o fluxo de commit já existem; só muda a entrada. **Custo:** 1 chamada de texto (mais barata que a de visão). **Risco:** baixo.

---

## Recomendação de ordem

**F6 → F2 → F1 → F4 → F3 → F5.** F6 é o menor esforço com dor mais aguda e mensurável (o funil do OCR já está instrumentado — dá pra provar a melhoria em uma semana). F2 é o maior impacto por real apostado (protege dinheiro no momento do compromisso). F1 é a feature-âncora do produto — maior esforço, mas com plano pronto e fundação testada. F4/F3/F5 são incrementais e independentes.

**Sinergia com a rodada 1:** F2 e F4 ficam 10× melhores depois do painel IA vs Pilot e do Telegram interativo (ambos aguardando decisão/BotFather do Pilot).
