# frozen_string_literal: true

require 'pg'

# Regressão 2026-07-30 — `balance_snapshots` nunca funcionou.
#
# Cadeia do defeito, toda verificada nas migrations:
#   0003 → `generate_balance_snapshots` nasce com grant só pra service_role.
#   0005 → revoke explícito de public/anon/authenticated (security hardening).
#   0014 → `resolve_bet` (SECURITY INVOKER, grant pra authenticated) passa a
#          chamar `PERFORM generate_balance_snapshots(...)` no fim.
#   0014 → o erro cai num `RAISE WARNING`, silencioso.
#
# Resultado: o app chama `resolve_bet` como usuário autenticado, que tenta
# executar uma função sem permissão, falha, e ninguém vê. A tabela ficou com 0
# linhas desde sempre; `daily_pl_view` vazia; `/forecast` preso em "ainda cedo
# demais". Não era falta de cron — era permissão.
#
# O grant não podia simplesmente voltar: a função é SECURITY DEFINER e itera
# sobre as casas de TODOS os usuários (`select id, user_id from houses`), que é
# exatamente a brecha que a 0005 fechou. A 0053 escopa por `auth.uid()` quando
# há usuário autenticado, mantendo o comportamento global para service_role
# (que é quem o cron usa).
#
# Este spec só roda com o Postgres de teste (o CI sobe um; localmente é pulado
# — ver spec_helper). É o harness que faltava desde a lição B13.
RSpec.describe 'generate_balance_snapshots', :db do
  let(:conn) { DBHelper.connect }

  before(:all) do
    # `ensure_schema!` já aplica TODAS as migrations quando o schema não existe,
    # e não faz nada quando já existe. Chamar `apply_all_migrations!` além dele
    # reaplica tudo e explode em `create type transaction_kind` (as migrations
    # não são idempotentes — é o comportamento correto para migration).
    ScraperDBHelper.ensure_schema!
  end

  after(:each) do
    c = DBHelper.connect
    c.exec('delete from balance_snapshots')
    c.exec('delete from transactions')
    c.exec('delete from houses')
    c.exec('delete from auth.users')
    c.close
  end

  # Cria usuário + casa + um depósito, devolve [user_id, house_id].
  def seed_casa(nome = 'Casa Teste')
    uid = conn.exec(
      "insert into auth.users (id, email) values (gen_random_uuid(), 't' || floor(random()*1e9)::text || '@teste.local') returning id"
    )[0]['id']
    # `slug` é NOT NULL com único em (user_id, slug) — derivo do nome pra não
    # colidir entre as casas do mesmo seed.
    hid = conn.exec_params(
      'insert into houses (user_id, name, slug) values ($1, $2, $3) returning id',
      [uid, nome, nome.downcase.gsub(/[^a-z0-9]+/, '-')]
    )[0]['id']
    conn.exec_params(
      "insert into transactions (user_id, house_id, kind, direction, amount, occurred_at)
       values ($1, $2, 'deposit', 'in', 100, now())", [uid, hid]
    )
    [uid, hid]
  end

  describe 'a função existe e produz linha' do
    it 'grava snapshot da casa' do
      seed_casa
      conn.exec("select generate_balance_snapshots(current_date)")
      n = conn.exec('select count(*)::int as n from balance_snapshots')[0]['n'].to_i
      expect(n).to eq(1)
    end

    it 'é idempotente — rodar duas vezes não duplica' do
      seed_casa
      2.times { conn.exec("select generate_balance_snapshots(current_date)") }
      n = conn.exec('select count(*)::int as n from balance_snapshots')[0]['n'].to_i
      expect(n).to eq(1)
    end
  end

  describe 'permissão (o defeito de origem)' do
    it 'authenticated PODE executar — sem isso o resolve_bet falha calado' do
      priv = conn.exec(
        "select has_function_privilege('authenticated',
           'public.generate_balance_snapshots(date)', 'EXECUTE') as ok"
      )[0]['ok']
      expect(priv).to eq('t')
    end

    it 'service_role continua podendo (é quem o cron usa)' do
      priv = conn.exec(
        "select has_function_privilege('service_role',
           'public.generate_balance_snapshots(date)', 'EXECUTE') as ok"
      )[0]['ok']
      expect(priv).to eq('t')
    end

    it 'anon NÃO pode' do
      priv = conn.exec(
        "select has_function_privilege('anon',
           'public.generate_balance_snapshots(date)', 'EXECUTE') as ok"
      )[0]['ok']
      expect(priv).to eq('f')
    end
  end

  describe 'escopo por usuário (o motivo de a 0005 ter revogado)' do
    it 'sem usuário autenticado (service_role/cron) gera pra TODOS' do
      seed_casa('A')
      seed_casa('B')
      conn.exec("select generate_balance_snapshots(current_date)")
      n = conn.exec('select count(*)::int as n from balance_snapshots')[0]['n'].to_i
      expect(n).to eq(2)
    end

    it 'com usuário autenticado gera SÓ as casas dele' do
      uid_a, = seed_casa('A')
      seed_casa('B')
      # simula o JWT que o PostgREST injeta — é o que auth.uid() lê
      conn.exec_params("select set_config('request.jwt.claim.sub', $1, false)", [uid_a])
      conn.exec("select generate_balance_snapshots(current_date)")
      rows = conn.exec('select user_id from balance_snapshots').to_a
      expect(rows.length).to eq(1)
      expect(rows[0]['user_id']).to eq(uid_a)
      conn.exec("select set_config('request.jwt.claim.sub', '', false)")
    end
  end
end
