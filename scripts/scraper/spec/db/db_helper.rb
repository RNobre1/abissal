require 'pg'

module DBHelper
  module_function

  # Migrations directory at the repo root — `scripts/scraper/` lives 2 levels
  # below the abissal repo root.
  MIGRATIONS_DIR = File.expand_path('../../../../supabase/migrations', __dir__)

  # TODAS as migrations rodam contra o test DB, da 0001 em diante. O filtro
  # antigo ("fixtures-domain = 0007+") quebrou quando os domínios se
  # intercalaram: 0014/0042 (banca) referenciam o tipo bet_status criado na
  # 0001, que era pulada → PG::UndefinedObject num DB limpo. As migrations de
  # banca dependem de auth.users/auth.uid() (Supabase) — ensure_auth_stub!
  # cria o stub mínimo do schema auth antes de aplicá-las.

  def test_url
    ENV.fetch(
      'DATABASE_URL_TEST',
      'postgres://adam:senha@localhost:5433/adam_stats_test'
    )
  end

  def connect
    PG.connect(test_url)
  end

  # O Postgres de teste está de pé? Memoizado — uma tentativa por processo,
  # não uma por exemplo.
  #
  # POR QUE (2026-07-30): sem o container, `PG.connect` levantava
  # `PG::ConnectionBad` dentro do `before(:all)` e os 31 specs de integração
  # FALHAVAM. A suíte local ficava permanentemente vermelha, e "31 falhas" virou
  # ruído de fundo que se aprende a ignorar — o que é exatamente o mecanismo que
  # deixa uma falha NOVA passar despercebida (foi preciso filtrar as falhas por
  # arquivo pra saber se uma mudança tinha quebrado algo). Um teste que não pode
  # rodar deve PULAR, nunca falhar: falha significa "o código está errado".
  def available?
    return @available unless @available.nil?

    @available = begin
      conn = PG.connect(test_url)
      conn.close
      true
    rescue PG::Error, StandardError
      false
    end
  end

  def reset_schema!
    conn = connect
    conn.query('DROP TABLE IF EXISTS league_baselines CASCADE')
    conn.query('DROP TABLE IF EXISTS analysis_cache CASCADE')
    conn.query('DROP TABLE IF EXISTS fixtures CASCADE')
    conn.close
  end

  # Supabase ships with anon/authenticated/service_role roles preinstalled.
  # On a bare Postgres container they don't exist, so the `to authenticated`
  # policy clauses in our migrations fail. Create them if missing.
  def ensure_supabase_roles!
    conn = connect
    %w[anon authenticated service_role].each do |role|
      conn.query(<<~SQL)
        DO $$ BEGIN
          IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '#{role}') THEN
            CREATE ROLE #{role} NOINHERIT NOLOGIN;
          END IF;
        END $$;
      SQL
    end
    conn.close
  end

  # Stub mínimo do schema `auth` do Supabase para um Postgres vanilla:
  # auth.users (alvo das FKs user_id) e auth.uid() (usada nas policies RLS).
  # No Supabase real esses objetos já existem — aqui só o suficiente pras
  # migrations aplicarem.
  def ensure_auth_stub!
    conn = connect
    conn.query(<<~SQL)
      CREATE SCHEMA IF NOT EXISTS auth;
      -- `email` e `raw_user_meta_data` não são decoração: o trigger
      -- `tg_handle_new_user()` (migration de user_profile) lê os dois no INSERT.
      -- Com o stub só de `id`, qualquer spec que crie um usuário quebrava em
      -- `record "new" has no field "raw_user_meta_data"`. O stub precisa cobrir
      -- o que as migrations de fato usam do Supabase, não o mínimo sintático.
      CREATE TABLE IF NOT EXISTS auth.users (
        id uuid PRIMARY KEY,
        email text,
        raw_user_meta_data jsonb
      );
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS email text;
      ALTER TABLE auth.users ADD COLUMN IF NOT EXISTS raw_user_meta_data jsonb;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid
        LANGUAGE sql STABLE
        AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    SQL
    conn.close
  end

  def apply_migration!(filename)
    path = File.join(MIGRATIONS_DIR, filename)
    sql = File.read(path)
    conn = connect
    conn.query(sql)
    conn.close
  end

  def apply_all_migrations!
    ensure_supabase_roles!
    ensure_auth_stub!
    Dir.glob(File.join(MIGRATIONS_DIR, '*.sql')).sort.each do |path|
      apply_migration!(File.basename(path))
    end
  end
end
