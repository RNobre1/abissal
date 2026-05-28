# Task: Parser detail page (Nokogiri)

> **Session:** Terminal 4 of 12
> **Branch:** `feat/mvp-v1-T4`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Implementar o parser Nokogiri da página de detalhe de um jogo no adamchoi (recent matches, H2H, streaks, trends), retornando uma estrutura JSON-serializable (`MatchDetail`) que vira o campo `detail_json` na tabela `fixtures`. **Pré-requisito interno:** mini-POC de captura de HTML de uma detail page real (estrutura ainda não inspecionada empiricamente).

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 3 paralela com T5 (persister). Sem conflito.
- **Decisions already made:** Nokogiri (ADR-001). Detail HTML estrutura **desconhecida** ainda — capturar dentro desta task.
- **Relevant CLAUDE.md sections:** "External services and APIs", "Data model" (campo `detail_json`).

---

## Files ALLOWED to touch

```
lib/scraper/detail_parser.rb
lib/scraper/match_detail.rb                    # struct/value-object
spec/scraper/detail_parser_spec.rb
spec/scraper/fixtures/adamchoi-detail-sample.html   # capturar via POC dentro desta task
.poc/detail-page-recon/                        # mini-POC ad-hoc (opcional, descartável)
```

---

## Files FORBIDDEN

```
lib/scraper/parser.rb                          # T3
lib/scraper/fetcher.rb                         # T6
lib/scraper/persister.rb                       # T5
db/**, infra/**, web/**, lib/api/**            # outras tasks
```

---

## Execution order (TDD mandatory)

### Phase 0 — Mini-POC de recon (~15min, pré-requisito desta task)

- [ ] Identificar URL de uma detail page (pegar `source_url` do snapshot do T3 ou navegar manualmente em adamchoi.co.uk e copiar 1 URL real)
- [ ] Rodar Playwright ad-hoc (pode reaproveitar `.poc/ruby-scraper-test/`) contra essa URL, salvar HTML como `spec/scraper/fixtures/adamchoi-detail-sample.html`
- [ ] Inspecionar HTML: identificar seletores pra: recent matches (últimos N jogos do home/away), H2H, streaks (W/D/L sequence), trends (over/under, BTTS%)
- [ ] Documentar no execution log os seletores encontrados

### Phase 1 — Tests first (RED)

- [ ] `spec/scraper/detail_parser_spec.rb` com cenários:
  - parse de snapshot real retorna `MatchDetail` com campos populados
  - `recent_matches.home` → array de N jogos recentes do time da casa
  - `recent_matches.away` → idem visitante
  - `h2h` → array de confrontos diretos passados
  - `streak.home` → string tipo `"W W D L W"` ou estrutura equivalente
  - `streak.away` → idem
  - `trends` → hash com `over_25_percent`, `btts_percent`, etc. (decidir nomes após recon)
  - HTML faltando seção → campo `nil` (não levanta exceção)
  - HTML totalmente vazio → `MatchDetail` com todos campos `nil`
- [ ] Red: detail_parser.rb não existe
- [ ] `git commit -m "test: detail page parser scenarios"`

### Phase 2 — Implementation (GREEN)

- [ ] `lib/scraper/match_detail.rb`:
  ```ruby
  module AdamStats
    module Scraper
      MatchDetail = Data.define(:recent_matches, :h2h, :streak, :trends)
    end
  end
  ```
  > `recent_matches` é `{home: [...], away: [...]}`, `streak` é `{home: ..., away: ...}`, `trends` é um Hash.
- [ ] `lib/scraper/detail_parser.rb`:
  - método `parse_detail(html_string) → MatchDetail`
  - usa Nokogiri + seletores descobertos no Phase 0
  - cada seção é extraída por método privado (`extract_recent_matches`, `extract_h2h`, etc.)
  - retorna `MatchDetail.new(nil, nil, nil, {})` se HTML não tem nada parseável (não-erro)
- [ ] Serializável: `MatchDetail#to_h.to_json` deve funcionar pra ir pro jsonb depois
- [ ] `git commit -m "feat(scraper): detail page parser for fixture stats"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Extrair patterns repetidos (parsing de tabela de matches passados, formato W/D/L)
- [ ] `git commit -m "refactor: ..."` se aplicável

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/scraper/detail_parser_spec.rb` passa
- [ ] `MatchDetail.to_h` é Hash JSON-serializable (chaves simétricas com banco)
- [ ] Tempo de parse < 200ms

---

## Acceptance criteria

- [ ] Detail HTML real capturado e salvo como fixture determinística
- [ ] `MatchDetail` struct cobre as 4 seções principais (recent matches, H2H, streak, trends)
- [ ] Parser é função pura (sem rede, sem DB)
- [ ] Estrutura serializa pra JSON compatível com jsonb do Postgres

---

## Mandatory test scenarios

```
AdamStats::Scraper::DetailParser.parse_detail
  - happy path: snapshot real → MatchDetail com 4 seções populadas
  - recent_matches.home tem >= 1 jogo
  - h2h tem >= 0 confrontos (pode ser empty se times nunca jogaram)
  - streak é parseável (W/D/L string ou array)
  - trends contém pelo menos um percentual numérico
  - HTML vazio → MatchDetail com nils, sem exceção
  - HTML faltando seção H2H → outros campos populados, h2h nil
  - to_h.to_json serializa sem erro
```

---

## Blockers — stop and alert the user if you encounter

- Detail page exige autenticação ou subscription (some leagues premium-only no adamchoi). Decisão de escopo: pular ligas premium ou pagar conta? Volta pro Pilot.
- Estrutura HTML totalmente diferente do esperado (JS-rendered post-load, fora da página inicial). Pode exigir wait extra no fetcher T6 — alertar.
- detail HTML tem >5MB — pode estourar `2MB` por row D1 / Postgres jsonb default? Postgres jsonb suporta TOAST automático; ainda assim alertar se >2MB.

---

## Execution log

- **Phase 0 (recon):** {{seletores encontrados, URL usada}}
- **Phase 1 (red):** {{...}}
- **Phase 2 (green):** {{...}}
- **Phase 3 (refactor):** {{...}}
- **Phase 4 (verification):** {{...}}

### Incidents / deviations

{{...}}

---

## State on pause

- **Done:** {{...}}
- **In progress:** {{...}}
- **Exact next step:** {{...}}
- **Tests:** {{...}}

---

## Notes for review session

- **Trade-offs taken:** Estrutura `MatchDetail` simples com 4 campos top-level — ergonomia > granularidade. Pode evoluir.
- **Deferred to other tasks:** Persistir o jsonb no DB com schema explícito (`fixture_details` table separada?) — fica YAGNI; jsonb na própria `fixtures` cobre.
- **Known risks:** adamchoi pode ter A/B testing ou variações de layout por liga. Mitigação: snapshot ≥ 2 ligas diferentes na fixture de teste.
