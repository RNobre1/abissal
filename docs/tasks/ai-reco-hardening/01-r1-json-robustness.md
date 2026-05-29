# Follow-up — robustez do parse de JSON do R1 no recomendador IA-2

> **Status:** ABERTO · **Registrado:** 2026-05-28 · **Gated:** só implementar
> **após o fim da hibernação IA/sim/calibração** (~2026-06-03), pois mexe no
> tratamento da chamada LLM do recomendador (model-adjacent). Confirmar a data
> com o Pilot ao retomar.

## Problema

O `deepseek/deepseek-r1` ocasionalmente devolve JSON **truncado ou malformado**.
Quando isso acontece, `runRecommender` lança e **nenhuma reco é salva** para a
fixture — em vez de degradar para um skip ou registrar um estado claro.

- **On-demand:** o usuário vê erro e precisa reapertar "pedir análise IA".
- **Batch (cron):** falha silenciosa — a fixture fica sem reco naquele dia
  (não vira nem `bet` nem `skip`).

## Evidência (via `llm_request_logs` + investigação 2026-05-28)

| quando (UTC) | route | fixture | erro |
|---|---|---|---|
| 2026-05-27 16:38 | `ai-reco-on-demand` | **8794** | `runRecommender threw: Unexpected end of JSON input` (latência 110s — resposta cortada) |
| 2026-05-27 11:28 | `ai-reco` (batch) | 19693456 | `failed to parse decision JSON (schema mismatch or invalid JSON)` |
| 2026-05-26 17:33/17:31/13:50 | `ai-reco` (batch) | (3 fixtures) | idem `failed to parse decision JSON` |

Não é frequente (um punhado em alguns dias), mas é recorrente.

> **NÃO confundir** com o cluster de 2026-05-25 (`OpenRouter HTTP 400: No models
> provided`) — esse era a **Lição B18** (ENV vazia `model=""`), **já corrigido**.

## Causa provável

Saída estruturada do R1 não é 100% confiável: respostas longas/lentas (p95 ~195s)
às vezes são truncadas, e o reasoning do R1 pode envolver o JSON de formas que
quebram o parse atual (`callOpenRouter` em `lib/bet-slip-ocr/...` é OCR; aqui é o
caminho do recomendador em `lib/ai-reco/recommender.ts` + `app/api/ai-reco/compute`).

## Opções de fix (quando desbloqueado — NÃO fazer na hibernação)

1. **Retry único** no parse-failure (re-chamar o R1 uma vez antes de desistir).
2. **JSON-repair / extração tolerante** (pegar o último bloco ```json válido).
3. **Capturar a resposta crua** em `llm_request_logs` (hoje só guarda a mensagem
   de erro) para diagnosticar truncamento vs schema-mismatch.
4. **Degradar para skip explícito** em vez de lançar — pelo menos a fixture fica
   marcada como "analisada" (e ganharia o badge "IA · sem valor").
5. Avaliar `response_format`/structured-output do OpenRouter se o R1 suportar.

## Não-objetivo

Não trocar de modelo nem mexer no prompt/edge/calibração durante a hibernação.
Relaciona-se à diretriz de hibernação (memória `hibernacao-ia-sim-calibracao`).

---

## Follow-up irmão — timeout HTTP no `OpenrouterClient` (2026-05-29)

> **Status:** ABERTO · **Gated:** pós-hibernação (mesma janela — mexe no caminho
> da chamada LLM). Registrado após a Parte A (ADR-010, paralelização das R1).

### Problema

`OpenrouterClient` (`lib/scraper/ai_reco/openrouter_client.rb`) usa `Faraday.new`
**sem `open_timeout`/`read_timeout`**. Com o adapter Net::HTTP default, uma
conexão R1 travada pode bloquear **indefinidamente** (até o servidor fechar).
Antes (chamadas seriais) cada call era independente; **após a Parte A** (ADR-010),
a **fase 3 (gravação) só roda depois que TODAS as chamadas R1 da fase 2 retornam**
— então uma única call travada gateia o lote inteiro e pode esticar o job em
direção ao `timeout-minutes: 45` do `ai-reco.yml`.

### Evidência

Não houve incidente: a validação ao vivo de 2026-05-29 (run `26637688431`) fechou
50 chamadas R1 em **17min56s** (folga grande sob 45min). É um risco **latente**,
não um bug observado.

### Fix proposto (quando desbloqueado)

1. Configurar `open_timeout` (~10s) e `read_timeout` (~240s — acima do p95 ~195s
   do R1) no `Faraday.new` do client. Uma call que estourar vira `ok:false`
   (já tratado → reco de falha com a copy PT-BR), não trava o pool.
2. (Opcional) timeout global da fase 2 como segunda camada.

### Por que junto deste doc

Ambos são robustez da MESMA chamada LLM (parse de JSON truncado + timeout de
rede), ambos model-adjacent ⇒ mesma janela de hibernação. Idealmente resolvidos
no mesmo PR de hardening do `OpenrouterClient`.
