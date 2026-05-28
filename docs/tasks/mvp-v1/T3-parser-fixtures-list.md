# Task: Parser fixtures list (Nokogiri)

> **Session:** Terminal 3 of 12
> **Branch:** `feat/mvp-v1-T3`
> **Status:** `[ ] Planning` `[ ] In progress` `[ ] Tests passing` `[ ] Ready for review`

---

## Objective

Implementar o parser Nokogiri que recebe o HTML cru da página `/fixtures` do adamchoi e devolve um array de `Fixture` structs (sem I/O, sem rede, sem DB — função pura). TDD usando os snapshots HTML dos POCs como fixtures determinísticas.

---

## Required context

- **Larger feature:** [00-overview.md](00-overview.md)
- **What other sessions are doing:** Wave 2 paralela com T2 (migration), T6 (fetcher), T10 (web scaffolding). Sem conflito — esta task é puro parsing in-memory.
- **Decisions already made:** Ruby 4.0.3, Nokogiri (ADR-001). Seletores canônicos descobertos no POC documentados em `CLAUDE.md#external-services-and-apis`.
- **Relevant CLAUDE.md sections:** "External services and APIs", "Data model" (campos esperados na struct Fixture).

---

## Files ALLOWED to touch

```
lib/scraper/parser.rb
lib/scraper/fixture.rb                         # struct/value-object da Fixture
spec/scraper/parser_spec.rb
spec/scraper/fixtures/adamchoi-fixtures-sample.html      # cópia do POC
spec/scraper/fixtures/adamchoi-fixtures-empty.html       # construído pra teste edge
spec/scraper/fixtures/adamchoi-fixtures-malformed.html   # construído pra teste edge
```

---

## Files FORBIDDEN

```
lib/scraper/fetcher.rb                         # T6
lib/scraper/persister.rb                       # T5
lib/scraper/detail_parser.rb                   # T4
db/**, infra/**, web/**                        # outras tasks
.poc/**                                        # POCs são read-only referência
```

---

## Execution order (TDD mandatory)

### Phase 1 — Tests first (RED)

- [ ] Copiar `.poc/ruby-scraper-test/snapshot.html` → `spec/scraper/fixtures/adamchoi-fixtures-sample.html` (snapshot Ruby — mais recente e maior, 2.7MB)
- [ ] Construir `adamchoi-fixtures-empty.html` (HTML válido com `<table>` sem rows)
- [ ] Construir `adamchoi-fixtures-malformed.html` (HTML quebrado: tags não fechadas, encoding errado)
- [ ] `spec/scraper/parser_spec.rb` com cenários:
  - parse de snapshot real retorna array com >= 100 fixtures
  - cada Fixture tem `home_team`, `away_team`, `league`, `ko_time`, `source_url` populados
  - HTML vazio → array vazio (não levanta exceção)
  - HTML malformado → levanta `AdamStats::Scraper::ParseError` com mensagem útil
  - seletor canônico `tr[data-ng-repeat="fixture in :refreshFixtures:league.fixtures"]` é a fonte de truth
- [ ] Rodar: red — parser.rb e fixture.rb não existem
- [ ] `git commit -m "test: parser scenarios for adamchoi fixtures list"`

### Phase 2 — Implementation (GREEN)

- [ ] `lib/scraper/fixture.rb`:
  ```ruby
  module AdamStats
    module Scraper
      Fixture = Data.define(:match_date, :ko_time, :home_team, :away_team, :league, :source_url)
    end
  end
  ```
  > Ruby 3.2+ tem `Data.define` (immutable value class). Ruby 4.0 mantém.
- [ ] `lib/scraper/parser.rb`:
  - `module AdamStats::Scraper::Parser`
  - método `parse_fixtures_list(html_string) → Array<Fixture>`
  - usa `Nokogiri::HTML(html)` + CSS selectors
  - extrai `match_date` parseando data do contexto (cabeçalho da liga ou tooltip)
  - extrai `ko_time` de `.fixture-ko-time` (cuidado com odds inline; usar regex `\A\d{2}:\d{2}` pra isolar)
  - levanta `ParseError` em HTML malformado (detecção: doc.errors.any?)
- [ ] `git commit -m "feat(scraper): nokogiri parser for adamchoi fixtures list"`

### Phase 3 — Refactoring (REFACTOR)

- [ ] Extrair helpers privados (`extract_team`, `extract_ko_time_only`) se ficar denso
- [ ] Garantir que o parser é re-entrante (chamar 2x com mesmo HTML → mesmo resultado)
- [ ] `git commit -m "refactor: ..."` se mudou algo de fato

### Phase 4 — Final verification

- [ ] `bundle exec rspec spec/scraper/parser_spec.rb` passa todos cenários
- [ ] Rubocop ou Standard (se configurado em T1) sem warnings
- [ ] Tempo de parse < 200ms (Nokogiri parseou 2.7MB em 78ms no POC — sobra margem)

---

## Acceptance criteria

- [ ] Parser extrai > 100 fixtures do snapshot Ruby POC (snapshot tem 426 fixtures reais)
- [ ] `Fixture` struct é immutable (`Data.define`)
- [ ] HTML edge cases tratados (empty / malformed)
- [ ] Zero dependência de I/O (parser é função pura)

---

## Mandatory test scenarios

```
AdamStats::Scraper::Parser.parse_fixtures_list
  - happy path: snapshot real → array com 100+ Fixture(s)
  - cada Fixture tem todos os campos não-null exceto opcionais
  - HTML vazio → array vazio sem exceção
  - HTML malformado → raise ParseError com contexto
  - chamadas repetidas são idempotentes (sem state interno)
  - ko_time não contém odds inline (regex isola hora)
```

---

## Blockers — stop and alert the user if you encounter

- Snapshot do POC não tem o campo X que a struct exige (ex: `match_date` pode não vir explícito por row — depende de ler do `<thead>` da liga). Decisão de modelagem pode subir pra ADR.
- Encoding issue (UTF-8 vs latin-1) — Nokogiri normalmente lida, mas se quebrar, alertar.

---

## Execution log

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

- **Trade-offs taken:** Parser puro (sem fetcher acoplado) — facilita TDD e troca futura de fonte. `Data.define` em vez de Struct (imutável).
- **Deferred to other tasks:** `match_date` parseada do header da seção da liga — se ficar complexo, pode ser refatorado pra T7 (orchestrator) sobrescrever com data do scrape day.
- **Known risks:** adamchoi pode mudar classes CSS sem aviso. Mitigação: T7 adiciona log + alerta se parser retornar 0 fixtures num horário com jogos.
