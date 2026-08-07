# frozen_string_literal: true

require_relative 'uk_time_helper'

module AdamStats
  module Scraper
    # PlaceholderGuard — barra fixture cuja IDENTIDADE ainda não existe na fonte.
    #
    # PROBLEMA (auditoria 2026-08-07): o choistats publica o playoff europeu
    # antes de sortear o mandante e antes de marcar a hora. Vinha `TBC x
    # Salzburg`, `TBC x TBC`, `Winner Quarter-final 1`, e o horário chegava como
    # a meia-noite UTC do dia. A simulação rodava assim mesmo e devolvia o prior
    # genérico — o mesmo vetor 1x2 linha após linha, que não é previsão, é
    # ausência de dado vestida de previsão. Consequências medidas: sims
    # reconciliadas contra o resultado real de jogos que nem eram aquele
    # confronto (o reconciler casa por data+liga), Brier/isotônica/arena
    # contaminados, e uma aposta real (`TBC x Salzburg → draw 0,06u @4,20`, RED).
    #
    # Mesma família de B50/B52 ("0 não é ausência de dado"), aqui na forma
    # "prior não é predição".
    #
    # Puro: recebe uma Fixture, devolve nil (segue) ou o motivo (barra).
    module PlaceholderGuard
      # Tokens que a fonte usa quando o time ainda não foi definido. Casados
      # como PALAVRA inteira — `\b` evita que "Energie Cottbus" ou "Hartberg"
      # sejam confundidos com placeholder por conterem as letras.
      TEAM_PLACEHOLDER_RE = /\b(?:tbc|tbd)\b/i
      # Chaveamento de mata-mata ainda não resolvido ("Winner Quarter-final 1",
      # "Loser Semi-final 2") — nome de um jogo, não de um time.
      BRACKET_PLACEHOLDER_RE = /\A\s*(?:winner|loser)\s+\S/i

      # Motivos que IMPEDEM a simulação. Só o time entra, e a razão é medida
      # (07/08, 1.104 fixtures vivas):
      #
      #   time placeholder → 14 fixtures, das quais 0 simulavam bem. Grátis.
      #   hora placeholder → 68 fixtures, das quais 59 (87%) simulavam BEM.
      #
      # O horário não participa do cálculo de λ — a simulação lê `avgs`, não o
      # relógio. Barrar por ele descartaria 5,3% do pipeline por dia para evitar
      # 1 prior genérico. Onde o horário falso de fato machuca é na captura de
      # closing odds (janela [KO+5min, KO+4h]) e na reconciliação; ali ele
      # precisa ser CONHECIDO, não usado como motivo para não simular.
      #
      # Por isso `reason` e `blocking?` são perguntas distintas: a primeira
      # diagnostica, a segunda decide.
      BLOCKING_REASONS = %i[team_placeholder].freeze

      module_function

      # Impede a simulação? Só o time placeholder — ver BLOCKING_REASONS.
      def blocking?(fixture)
        BLOCKING_REASONS.include?(reason(fixture))
      end

      # @param fixture [Fixture]
      # @return [Symbol, nil] nil quando a fixture está íntegra; caso contrário
      #   :team_placeholder, :kickoff_missing ou :kickoff_placeholder.
      #   ⚠️ Nem todo motivo bloqueia — use #blocking? para decidir.
      def reason(fixture)
        return :team_placeholder if placeholder_team?(fixture.home_team) ||
                                    placeholder_team?(fixture.away_team)

        ko = fixture.ko_time
        return :kickoff_missing if ko.nil? || ko.to_s.strip.empty?
        return :kickoff_placeholder if midnight_utc?(fixture.match_date, ko)

        nil
      end

      def placeholder_team?(name)
        s = name.to_s.strip
        return true if s.empty?

        TEAM_PLACEHOLDER_RE.match?(s) || BRACKET_PLACEHOLDER_RE.match?(s)
      end

      # A fonte carimba a meia-noite UTC do PRÓPRIO dia quando não sabe a hora —
      # é literalmente o mesmo timestamp do contêiner do dia no payload da
      # listagem (verificado contra a API em 07/08: 6 de 6 jogos com hora
      # indefinida vinham com `date` idêntico ao `date` do dia).
      #
      # Note que o marcador é o INSTANTE UTC, não o horário local: em BST a hora
      # local correspondente é 01:00 e em GMT é 00:00. Um jogo genuinamente
      # marcado para a meia-noite UTC cravada seria barrado junto — falso
      # positivo aceito, porque o custo é deixar de simular um jogo e o custo
      # oposto é publicar um prior como se fosse previsão.
      def midnight_utc?(match_date, ko_time)
        utc = UkTimeHelper.to_utc(match_date, ko_time)
        return false if utc.nil?

        utc == Time.utc(match_date.year, match_date.month, match_date.day, 0, 0, 0)
      end
    end
  end
end
