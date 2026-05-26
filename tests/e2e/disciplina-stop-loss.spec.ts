/**
 * E2E — Disciplina: stop-loss bloqueia 4ª aposta após atingir limite
 *
 * Scenario (manual checklist — automatizar quando auth E2E estiver configurado):
 *
 * Pré-condições:
 *   - Usuário logado com banca de R$1000
 *   - disciplina_settings: stop_loss_daily_pct=5, max_bets_per_day=3
 *
 * Passos:
 *   1. Acessa /bets/new
 *   2. Cria Aposta 1 (R$10, lost → R$0 retorno) — PL=-10, drawdown=1% < 5%
 *   3. Cria Aposta 2 (R$10, lost → R$0 retorno) — PL=-20, drawdown=2% < 5%
 *   4. Cria Aposta 3 (R$30, lost → R$0 retorno) — PL=-50, drawdown=5% >= 5%
 *   5. Tenta criar Aposta 4
 *   6. Esperado: formulário retorna erro "Stop-loss diário de 5% atingido"
 *   7. Verificar mensagem: "Próximo reset 00:00 BRT"
 *
 * Alternativa — max_bets_per_day:
 *   1. Cria 3 apostas quaisquer
 *   2. Tenta criar 4ª
 *   3. Esperado: erro "Máximo de 3 apostas por dia atingido"
 *
 * NOTA: Este teste não está automatizado pois depende de auth E2E real
 * (Supabase session + cookies). O Pilot deve rodar manualmente contra
 * ambiente de staging com as credenciais corretas.
 *
 * Para automatizar no futuro:
 *   - Usar `page.route('/api/auth/**', ...)` para injetar sessão
 *   - Ou criar usuário de teste via supabase-js admin client no beforeEach
 */

import { test, expect } from "@playwright/test";

test.skip("disciplina: 4ª aposta é bloqueada após stop-loss diário atingido", async ({ page }) => {
  // Passo 1: Login
  await page.goto("/login");
  await page.fill('[name="email"]', process.env.E2E_USER_EMAIL ?? "");
  await page.fill('[name="password"]', process.env.E2E_USER_PASSWORD ?? "");
  await page.click('[type="submit"]');
  await page.waitForURL("/");

  // Passo 2-4: Criar 3 apostas perdidas que atingem stop-loss de 5%
  // (implementar quando auth E2E estiver configurado)

  // Passo 5: Tentativa da 4ª aposta
  await page.goto("/bets/new");
  // preencher formulário...
  await page.click('[type="submit"]');

  // Passo 6-7: Verificar mensagem de bloqueio
  await expect(page.getByRole("alert")).toContainText(/stop.loss/i);
  await expect(page.getByRole("alert")).toContainText(/00:00 BRT/i);
});

test.skip("disciplina: 4ª aposta é bloqueada por max_bets_per_day=3", async ({ page }) => {
  // Similar ao acima mas com limite de apostas por dia
  await page.goto("/bets/new");
  await expect(page.getByRole("alert")).toContainText(/máximo/i);
});
