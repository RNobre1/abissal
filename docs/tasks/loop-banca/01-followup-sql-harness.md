# Follow-up: harness SQL para migração 0014 (resolve_bet + generate_balance_snapshots)

**Status:** PENDENTE  
**Origem:** spec-review de loop-banca (2026-05-18) — exceção consciente documentada em CLAUDE.md Lesson B13.

---

## Contexto

A migration `0014_banca_loop.sql` implementa:

- `resolve_bet(p_bet_id, p_status, p_actual_return)` — RPC principal que atualiza o ledger (`bets`, `transactions`, `house_balances`) e chama `generate_balance_snapshots` no bloco `EXCEPTION WHEN OTHERS THEN RAISE WARNING` (snapshot-safe: falha no snapshot não reverte o ledger).
- `roi_by_house_view` e `roi_by_period_view` — views de agregação sobre o ledger.

O comportamento **comportamental** dessas construções (que `resolve_bet` realmente persiste as linhas corretas, que o snapshot é idempotente via `ON CONFLICT DO UPDATE`, que as views retornam as colunas certas com os valores certos) **não pode ser testado sem um Postgres real rodando com o schema completo aplicado**.

O SQL foi auditado estaticamente pela spec-review e aprovado. Os testes app-side em `tests/integration/banca-snapshot.test.ts` cobrem o contrato da action (`resolveBetAction` propaga erros, chama RPC com params corretos), mas NÃO verificam o comportamento SQL.

---

## Harness mínimo

Para fechar esta lacuna, implementar:

### 1. Docker Compose com Supabase local

O repositório `abissal` já tem `docker compose` para infra. Adicionar um `docker-compose.test.yml` ou usar o `supabase/config.toml` existente com `supabase start`:

```bash
supabase start          # Sobe Postgres local na porta 54322
supabase db push        # Aplica todas as migrations
```

### 2. Script de seed

Criar `tests/sql-harness/seed.sql` com:
- `INSERT INTO houses` — uma casa para testar.
- `INSERT INTO bets` (status='pending') — uma aposta pendente.
- `INSERT INTO transactions` (deposit) — capital inicial.

### 3. Testes SQL reais

Arquivo `tests/sql-harness/resolve-bet.test.ts` (vitest + `pg` driver):

```typescript
// Conectar ao Postgres local (DATABASE_URL_TEST do docker compose)
// Aplicar seed
// CALL resolve_bet(...) via supabase.rpc ou pg.query
// Assert: bets.status = 'won', transactions inserida, balance_snapshots upsertado
// Segunda chamada → assert erro "already resolved" (idempotência)
```

### 4. Integração CI

Adicionar job `.github/workflows/test.yml`:
```yaml
- name: Start Supabase local
  run: supabase start
- name: Push migrations
  run: supabase db push
- name: Run SQL harness
  run: pnpm test:sql
```

---

## Critérios de aceitação

- [ ] `resolve_bet` persiste `bets.status`, `bets.resolved_at`, `bets.actual_return` corretamente.
- [ ] `resolve_bet` insere linha em `transactions` com `direction='credit'` e `amount=actual_return`.
- [ ] Segunda chamada com mesmo `bet_id` retorna erro `"bet already resolved"`.
- [ ] `generate_balance_snapshots` é idempotente (dois INSERTs com mesma data → mesma linha via `ON CONFLICT DO UPDATE`).
- [ ] `roi_by_house_view` retorna `pl`, `yield`, `roi`, `win_rate` com valores numericamente corretos para dataset de seed.
- [ ] `roi_by_period_view` agrega por mês (`YYYY-MM`) e retorna `rolling-30d` corretamente.
- [ ] **Isolamento cross-tenant (C1/OWASP A01):** consultar `roi_by_house_view` ou `roi_by_period_view` como usuário A não retorna nenhuma linha do usuário B. Validar criando dois usuários com bets distintos via seed e confirmando que cada sessão autenticada vê apenas suas próprias linhas (exige harness Postgres real + `SET LOCAL role` por sessão para simular RLS).

---

## Prioridade

**Baixa** — o SQL foi auditado manualmente; os testes app-side cobrem o contrato da action. Este harness é uma rede de segurança adicional contra regressões futuras em SQL, não um bloqueador funcional.
