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
      CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);
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
