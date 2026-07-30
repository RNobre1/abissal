require_relative 'db/db_helper'

# Specs marcados com `:db` precisam do Postgres de teste (o serviço postgres:17
# do job `scraper` no ci.yml, em localhost:5433). Sem ele, são EXCLUÍDOS em vez
# de falharem: um teste que não pode rodar não é um teste que reprovou, e 31
# falhas permanentes viram ruído que esconde a falha nova (ver DBHelper.available?).
#
# Em CI o comportamento é o oposto — lá o container é garantido, então "sem DB"
# é falha de infraestrutura e precisa GRITAR, nunca pular em silêncio. Pular no
# CI transformaria uma esteira quebrada em esteira verde, que é pior que vermelha.
DB_DISPONIVEL = DBHelper.available?

if !DB_DISPONIVEL && ENV['CI']
  abort(
    "\n[spec_helper] Postgres de teste indisponível em #{DBHelper.test_url}.\n" \
    "Em CI o serviço postgres:17 deveria estar de pé — abortando em vez de pular " \
    "os specs de integração (uma esteira verde por omissão é pior que vermelha).\n"
  )
end

RSpec.configure do |config|
  unless DB_DISPONIVEL
    config.filter_run_excluding :db
    config.before(:suite) do
      warn(
        "[spec_helper] Postgres de teste ausente (#{DBHelper.test_url}) — " \
        "specs de integração DB EXCLUÍDOS. Suba o container ou aponte " \
        "DATABASE_URL_TEST pra rodá-los; o CI sempre roda."
      )
    end
  end

  config.expect_with :rspec do |expectations|
    expectations.include_chain_clauses_in_custom_matcher_descriptions = true
  end

  config.mock_with :rspec do |mocks|
    mocks.verify_partial_doubles = true
  end

  config.shared_context_metadata_behavior = :apply_to_host_groups
  config.disable_monkey_patching!
  config.warnings = true
  config.default_formatter = 'doc' if config.files_to_run.one?
  config.order = :random
  Kernel.srand config.seed
end

PROJECT_ROOT = File.expand_path('..', __dir__)
