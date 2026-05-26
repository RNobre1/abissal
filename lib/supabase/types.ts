export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_predictions: {
        Row: {
          actual_away_goals: number | null
          actual_home_goals: number | null
          actual_resolved_at: string | null
          away_team: string
          correct_over_under: boolean | null
          correct_winner: boolean | null
          created_at: string
          fixture_id: number | null
          home_team: string
          id: number
          kickoff_utc: string | null
          league: string | null
          model: string | null
          pred_confidence: number
          pred_over_under: string
          pred_winner: string
          raw_excerpt: string | null
          reasoner: boolean
          route: string
          status: string
        }
        Insert: {
          actual_away_goals?: number | null
          actual_home_goals?: number | null
          actual_resolved_at?: string | null
          away_team: string
          correct_over_under?: boolean | null
          correct_winner?: boolean | null
          created_at?: string
          fixture_id?: number | null
          home_team: string
          id?: never
          kickoff_utc?: string | null
          league?: string | null
          model?: string | null
          pred_confidence: number
          pred_over_under: string
          pred_winner: string
          raw_excerpt?: string | null
          reasoner?: boolean
          route: string
          status?: string
        }
        Update: {
          actual_away_goals?: number | null
          actual_home_goals?: number | null
          actual_resolved_at?: string | null
          away_team?: string
          correct_over_under?: boolean | null
          correct_winner?: boolean | null
          created_at?: string
          fixture_id?: number | null
          home_team?: string
          id?: never
          kickoff_utc?: string | null
          league?: string | null
          model?: string | null
          pred_confidence?: number
          pred_over_under?: string
          pred_winner?: string
          raw_excerpt?: string | null
          reasoner?: boolean
          route?: string
          status?: string
        }
        Relationships: []
      }
      ai_reco_feedback: {
        Row: {
          ai_recommendation_id: number
          comment: string | null
          created_at: string
          id: number
          updated_at: string
          user_decision: string
        }
        Insert: {
          ai_recommendation_id: number
          comment?: string | null
          created_at?: string
          id?: number
          updated_at?: string
          user_decision: string
        }
        Update: {
          ai_recommendation_id?: number
          comment?: string | null
          created_at?: string
          id?: number
          updated_at?: string
          user_decision?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_reco_feedback_ai_recommendation_id_fkey"
            columns: ["ai_recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_recommendations: {
        Row: {
          actual_away_goals: number | null
          actual_home_goals: number | null
          actual_resolved_at: string | null
          away_team: string
          bet_won: boolean | null
          confidence: string | null
          cost_usd: number | null
          created_at: string
          edge_pct: number | null
          edge_table_snapshot: Json
          fixture_id: number | null
          home_team: string
          id: number
          kelly_pre: number | null
          kickoff_utc: string | null
          league: string | null
          league_calibrated: boolean
          llm_log_id: number | null
          llm_model: string
          market: string | null
          odd_captured: number | null
          pl_units: number | null
          prob_calibrated: number | null
          prob_estimated: number | null
          prompt_version: string
          reasoning_full: string | null
          reco_version: string
          red_flags: Json | null
          reduction_reason: string | null
          side: string | null
          status: string
          summary_line: string | null
          units_final: number | null
          verdict: string
        }
        Insert: {
          actual_away_goals?: number | null
          actual_home_goals?: number | null
          actual_resolved_at?: string | null
          away_team: string
          bet_won?: boolean | null
          confidence?: string | null
          cost_usd?: number | null
          created_at?: string
          edge_pct?: number | null
          edge_table_snapshot: Json
          fixture_id?: number | null
          home_team: string
          id?: number
          kelly_pre?: number | null
          kickoff_utc?: string | null
          league?: string | null
          league_calibrated?: boolean
          llm_log_id?: number | null
          llm_model: string
          market?: string | null
          odd_captured?: number | null
          pl_units?: number | null
          prob_calibrated?: number | null
          prob_estimated?: number | null
          prompt_version: string
          reasoning_full?: string | null
          reco_version: string
          red_flags?: Json | null
          reduction_reason?: string | null
          side?: string | null
          status?: string
          summary_line?: string | null
          units_final?: number | null
          verdict: string
        }
        Update: {
          actual_away_goals?: number | null
          actual_home_goals?: number | null
          actual_resolved_at?: string | null
          away_team?: string
          bet_won?: boolean | null
          confidence?: string | null
          cost_usd?: number | null
          created_at?: string
          edge_pct?: number | null
          edge_table_snapshot?: Json
          fixture_id?: number | null
          home_team?: string
          id?: number
          kelly_pre?: number | null
          kickoff_utc?: string | null
          league?: string | null
          league_calibrated?: boolean
          llm_log_id?: number | null
          llm_model?: string
          market?: string | null
          odd_captured?: number | null
          pl_units?: number | null
          prob_calibrated?: number | null
          prob_estimated?: number | null
          prompt_version?: string
          reasoning_full?: string | null
          reco_version?: string
          red_flags?: Json | null
          reduction_reason?: string | null
          side?: string | null
          status?: string
          summary_line?: string | null
          units_final?: number | null
          verdict?: string
        }
        Relationships: []
      }
      alert_dismissals: {
        Row: {
          dismissed_at: string
          fixture_id: number
          user_id: string
        }
        Insert: {
          dismissed_at?: string
          fixture_id: number
          user_id: string
        }
        Update: {
          dismissed_at?: string
          fixture_id?: number
          user_id?: string
        }
        Relationships: []
      }
      analysis_cache: {
        Row: {
          content_hash: string
          created_at: string
          fixture_id: number
          id: number
          response_json: Json
        }
        Insert: {
          content_hash: string
          created_at?: string
          fixture_id: number
          id?: number
          response_json: Json
        }
        Update: {
          content_hash?: string
          created_at?: string
          fixture_id?: number
          id?: number
          response_json?: Json
        }
        Relationships: [
          {
            foreignKeyName: "analysis_cache_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixture_badges_view"
            referencedColumns: ["fixture_id"]
          },
          {
            foreignKeyName: "analysis_cache_fixture_id_fkey"
            columns: ["fixture_id"]
            isOneToOne: false
            referencedRelation: "fixtures"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: Database["public"]["Enums"]["audit_action"]
          after: Json | null
          before: Json | null
          context: Json | null
          entity_id: string | null
          entity_type: string
          id: string
          occurred_at: string
          user_id: string | null
        }
        Insert: {
          action: Database["public"]["Enums"]["audit_action"]
          after?: Json | null
          before?: Json | null
          context?: Json | null
          entity_id?: string | null
          entity_type: string
          id?: string
          occurred_at?: string
          user_id?: string | null
        }
        Update: {
          action?: Database["public"]["Enums"]["audit_action"]
          after?: Json | null
          before?: Json | null
          context?: Json | null
          entity_id?: string | null
          entity_type?: string
          id?: string
          occurred_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      balance_snapshots: {
        Row: {
          balance: number
          created_at: string | null
          deposits_to_date: number
          house_id: string
          id: string
          pending_stake: number
          returned_to_date: number
          snapshot_date: string
          staked_to_date: number
          user_id: string
          withdrawals_to_date: number
        }
        Insert: {
          balance: number
          created_at?: string | null
          deposits_to_date?: number
          house_id: string
          id?: string
          pending_stake?: number
          returned_to_date?: number
          snapshot_date: string
          staked_to_date?: number
          user_id: string
          withdrawals_to_date?: number
        }
        Update: {
          balance?: number
          created_at?: string | null
          deposits_to_date?: number
          house_id?: string
          id?: string
          pending_stake?: number
          returned_to_date?: number
          snapshot_date?: string
          staked_to_date?: number
          user_id?: string
          withdrawals_to_date?: number
        }
        Relationships: [
          {
            foreignKeyName: "balance_snapshots_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "house_balance_view"
            referencedColumns: ["house_id"]
          },
          {
            foreignKeyName: "balance_snapshots_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "balance_snapshots_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "roi_by_house_view"
            referencedColumns: ["house_id"]
          },
        ]
      }
      bet_events: {
        Row: {
          bet_id: string
          diff: Json | null
          event_type: Database["public"]["Enums"]["bet_event_type"]
          from_status: Database["public"]["Enums"]["bet_status"] | null
          id: string
          occurred_at: string
          to_status: Database["public"]["Enums"]["bet_status"] | null
          trigger_source: string
          user_id: string
        }
        Insert: {
          bet_id: string
          diff?: Json | null
          event_type: Database["public"]["Enums"]["bet_event_type"]
          from_status?: Database["public"]["Enums"]["bet_status"] | null
          id?: string
          occurred_at?: string
          to_status?: Database["public"]["Enums"]["bet_status"] | null
          trigger_source?: string
          user_id: string
        }
        Update: {
          bet_id?: string
          diff?: Json | null
          event_type?: Database["public"]["Enums"]["bet_event_type"]
          from_status?: Database["public"]["Enums"]["bet_status"] | null
          id?: string
          occurred_at?: string
          to_status?: Database["public"]["Enums"]["bet_status"] | null
          trigger_source?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_events_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_selections: {
        Row: {
          bet_id: string
          created_at: string | null
          event_date: string | null
          event_label: string
          id: string
          league: string | null
          market_id: string | null
          odd_taken: number | null
          odds: number
          position_index: number
          selection_label: string
          sport_id: string | null
          status: Database["public"]["Enums"]["bet_status"]
          user_id: string
        }
        Insert: {
          bet_id: string
          created_at?: string | null
          event_date?: string | null
          event_label: string
          id?: string
          league?: string | null
          market_id?: string | null
          odd_taken?: number | null
          odds: number
          position_index?: number
          selection_label: string
          sport_id?: string | null
          status?: Database["public"]["Enums"]["bet_status"]
          user_id: string
        }
        Update: {
          bet_id?: string
          created_at?: string | null
          event_date?: string | null
          event_label?: string
          id?: string
          league?: string | null
          market_id?: string | null
          odd_taken?: number | null
          odds?: number
          position_index?: number
          selection_label?: string
          sport_id?: string | null
          status?: Database["public"]["Enums"]["bet_status"]
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_selections_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_selections_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_selections_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_slip_legs: {
        Row: {
          ai_recommendation_id: number | null
          away_team: string | null
          created_at: string
          fixture_id: number | null
          home_team: string | null
          id: number
          kickoff_utc: string | null
          league: string | null
          market: string
          market_id: string | null
          odd_taken: number
          side: string
          slip_id: number
          sport_id: string | null
        }
        Insert: {
          ai_recommendation_id?: number | null
          away_team?: string | null
          created_at?: string
          fixture_id?: number | null
          home_team?: string | null
          id?: number
          kickoff_utc?: string | null
          league?: string | null
          market: string
          market_id?: string | null
          odd_taken: number
          side: string
          slip_id: number
          sport_id?: string | null
        }
        Update: {
          ai_recommendation_id?: number | null
          away_team?: string | null
          created_at?: string
          fixture_id?: number | null
          home_team?: string | null
          id?: number
          kickoff_utc?: string | null
          league?: string | null
          market?: string
          market_id?: string | null
          odd_taken?: number
          side?: string
          slip_id?: number
          sport_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bet_slip_legs_ai_recommendation_id_fkey"
            columns: ["ai_recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_slip_legs_market_id_fkey"
            columns: ["market_id"]
            isOneToOne: false
            referencedRelation: "markets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_slip_legs_slip_id_fkey"
            columns: ["slip_id"]
            isOneToOne: false
            referencedRelation: "bet_slips"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bet_slip_legs_sport_id_fkey"
            columns: ["sport_id"]
            isOneToOne: false
            referencedRelation: "sports"
            referencedColumns: ["id"]
          },
        ]
      }
      bet_slips: {
        Row: {
          bet_id: string | null
          created_at: string
          id: number
          odd_combined: number | null
          potential_return: number | null
          stake_total: number | null
          status: string
          thesis: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          bet_id?: string | null
          created_at?: string
          id?: number
          odd_combined?: number | null
          potential_return?: number | null
          stake_total?: number | null
          status?: string
          thesis?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          bet_id?: string | null
          created_at?: string
          id?: number
          odd_combined?: number | null
          potential_return?: number | null
          stake_total?: number | null
          status?: string
          thesis?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bet_slips_bet_id_fkey"
            columns: ["bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
        ]
      }
      bets: {
        Row: {
          actual_return: number | null
          ai_recommendation_id: number | null
          created_at: string | null
          expected_return: number
          house_id: string
          id: string
          kind: Database["public"]["Enums"]["bet_kind"]
          note: string | null
          placed_at: string
          resolved_at: string | null
          status: Database["public"]["Enums"]["bet_status"]
          tags: string[] | null
          thesis: string | null
          total_odds: number
          total_stake: number
          updated_at: string | null
          user_id: string
        }
        Insert: {
          actual_return?: number | null
          ai_recommendation_id?: number | null
          created_at?: string | null
          expected_return: number
          house_id: string
          id?: string
          kind: Database["public"]["Enums"]["bet_kind"]
          note?: string | null
          placed_at?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["bet_status"]
          tags?: string[] | null
          thesis?: string | null
          total_odds: number
          total_stake: number
          updated_at?: string | null
          user_id: string
        }
        Update: {
          actual_return?: number | null
          ai_recommendation_id?: number | null
          created_at?: string | null
          expected_return?: number
          house_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["bet_kind"]
          note?: string | null
          placed_at?: string
          resolved_at?: string | null
          status?: Database["public"]["Enums"]["bet_status"]
          tags?: string[] | null
          thesis?: string | null
          total_odds?: number
          total_stake?: number
          updated_at?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "bets_ai_recommendation_id_fkey"
            columns: ["ai_recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bets_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "house_balance_view"
            referencedColumns: ["house_id"]
          },
          {
            foreignKeyName: "bets_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bets_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "roi_by_house_view"
            referencedColumns: ["house_id"]
          },
        ]
      }
      closing_odds: {
        Row: {
          ai_recommendation_id: number | null
          captured_at: string
          fixture_id: number
          id: number
          market: string
          odd_close: number
          side: string
          source: string
        }
        Insert: {
          ai_recommendation_id?: number | null
          captured_at?: string
          fixture_id: number
          id?: number
          market: string
          odd_close: number
          side: string
          source: string
        }
        Update: {
          ai_recommendation_id?: number | null
          captured_at?: string
          fixture_id?: number
          id?: number
          market?: string
          odd_close?: number
          side?: string
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "closing_odds_ai_recommendation_id_fkey"
            columns: ["ai_recommendation_id"]
            isOneToOne: false
            referencedRelation: "ai_recommendations"
            referencedColumns: ["id"]
          },
        ]
      }
      disciplina_settings: {
        Row: {
          cooldown_after_loss_min: number | null
          created_at: string | null
          max_bets_per_day: number | null
          quiet_mode_drawdown_pct: number | null
          quiet_mode_enabled: boolean | null
          quiet_mode_until: string | null
          stop_loss_daily_pct: number | null
          thesis_gate_enabled: boolean | null
          updated_at: string | null
          user_id: string
        }
        Insert: {
          cooldown_after_loss_min?: number | null
          created_at?: string | null
          max_bets_per_day?: number | null
          quiet_mode_drawdown_pct?: number | null
          quiet_mode_enabled?: boolean | null
          quiet_mode_until?: string | null
          stop_loss_daily_pct?: number | null
          thesis_gate_enabled?: boolean | null
          updated_at?: string | null
          user_id: string
        }
        Update: {
          cooldown_after_loss_min?: number | null
          created_at?: string | null
          max_bets_per_day?: number | null
          quiet_mode_drawdown_pct?: number | null
          quiet_mode_enabled?: boolean | null
          quiet_mode_until?: string | null
          stop_loss_daily_pct?: number | null
          thesis_gate_enabled?: boolean | null
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
      fixture_simulations: {
        Row: {
          actual_away_goals: number | null
          actual_btts: boolean | null
          actual_cards_away: number | null
          actual_cards_home: number | null
          actual_corners_away: number | null
          actual_corners_home: number | null
          actual_home_goals: number | null
          actual_resolved_at: string | null
          actual_sot_away: number | null
          actual_sot_home: number | null
          away_team: string
          correct_over_under: boolean | null
          correct_winner: boolean | null
          created_at: string
          fixture_id: number | null
          home_team: string
          id: number
          kickoff_utc: string | null
          league: string | null
          market_anchor: Json | null
          model_version: string
          p_away: number | null
          p_btts: number | null
          p_draw: number | null
          p_home: number | null
          p_over_25: number | null
          per_half_available: boolean | null
          player_events: Json | null
          sim_stats: Json | null
          status: string
          top_scorelines: Json | null
        }
        Insert: {
          actual_away_goals?: number | null
          actual_btts?: boolean | null
          actual_cards_away?: number | null
          actual_cards_home?: number | null
          actual_corners_away?: number | null
          actual_corners_home?: number | null
          actual_home_goals?: number | null
          actual_resolved_at?: string | null
          actual_sot_away?: number | null
          actual_sot_home?: number | null
          away_team: string
          correct_over_under?: boolean | null
          correct_winner?: boolean | null
          created_at?: string
          fixture_id?: number | null
          home_team: string
          id?: never
          kickoff_utc?: string | null
          league?: string | null
          market_anchor?: Json | null
          model_version: string
          p_away?: number | null
          p_btts?: number | null
          p_draw?: number | null
          p_home?: number | null
          p_over_25?: number | null
          per_half_available?: boolean | null
          player_events?: Json | null
          sim_stats?: Json | null
          status?: string
          top_scorelines?: Json | null
        }
        Update: {
          actual_away_goals?: number | null
          actual_btts?: boolean | null
          actual_cards_away?: number | null
          actual_cards_home?: number | null
          actual_corners_away?: number | null
          actual_corners_home?: number | null
          actual_home_goals?: number | null
          actual_resolved_at?: string | null
          actual_sot_away?: number | null
          actual_sot_home?: number | null
          away_team?: string
          correct_over_under?: boolean | null
          correct_winner?: boolean | null
          created_at?: string
          fixture_id?: number | null
          home_team?: string
          id?: never
          kickoff_utc?: string | null
          league?: string | null
          market_anchor?: Json | null
          model_version?: string
          p_away?: number | null
          p_btts?: number | null
          p_draw?: number | null
          p_home?: number | null
          p_over_25?: number | null
          per_half_available?: boolean | null
          player_events?: Json | null
          sim_stats?: Json | null
          status?: string
          top_scorelines?: Json | null
        }
        Relationships: []
      }
      fixtures: {
        Row: {
          away_team: string
          country: string | null
          detail_json: Json | null
          home_team: string
          id: number
          kickoff_utc: string | null
          ko_time: string | null
          league: string | null
          match_date: string
          scraped_at: string
          source_url: string | null
          status: string
        }
        Insert: {
          away_team: string
          country?: string | null
          detail_json?: Json | null
          home_team: string
          id?: number
          kickoff_utc?: string | null
          ko_time?: string | null
          league?: string | null
          match_date: string
          scraped_at?: string
          source_url?: string | null
          status?: string
        }
        Update: {
          away_team?: string
          country?: string | null
          detail_json?: Json | null
          home_team?: string
          id?: number
          kickoff_utc?: string | null
          ko_time?: string | null
          league?: string | null
          match_date?: string
          scraped_at?: string
          source_url?: string | null
          status?: string
        }
        Relationships: []
      }
      houses: {
        Row: {
          archived_at: string | null
          color_hex: string | null
          created_at: string | null
          id: string
          name: string
          notes_md: string | null
          slug: string
          updated_at: string | null
          user_id: string
          website_url: string | null
        }
        Insert: {
          archived_at?: string | null
          color_hex?: string | null
          created_at?: string | null
          id?: string
          name: string
          notes_md?: string | null
          slug: string
          updated_at?: string | null
          user_id: string
          website_url?: string | null
        }
        Update: {
          archived_at?: string | null
          color_hex?: string | null
          created_at?: string | null
          id?: string
          name?: string
          notes_md?: string | null
          slug?: string
          updated_at?: string | null
          user_id?: string
          website_url?: string | null
        }
        Relationships: []
      }
      league_baselines: {
        Row: {
          avg_percent: number | null
          computed_at: string
          league: string
          sample_size: number
          stat_label: string
        }
        Insert: {
          avg_percent?: number | null
          computed_at?: string
          league: string
          sample_size: number
          stat_label: string
        }
        Update: {
          avg_percent?: number | null
          computed_at?: string
          league?: string
          sample_size?: number
          stat_label?: string
        }
        Relationships: []
      }
      league_parameters: {
        Row: {
          created_at: string
          effective_from: string
          effective_until: string | null
          id: number
          league: string
          model_version: string
          n: number
          param: string
          value: number
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: never
          league: string
          model_version: string
          n: number
          param: string
          value: number
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: never
          league?: string
          model_version?: string
          n?: number
          param?: string
          value?: number
        }
        Relationships: []
      }
      llm_request_logs: {
        Row: {
          ai_recommendation_id: number | null
          cached: boolean
          completion_tokens: number | null
          cost_usd: number | null
          created_at: string
          error: string | null
          fixture_id: number | null
          follow_up: boolean
          hops: Json | null
          id: number
          latency_ms: number | null
          model: string
          prompt_snapshot: Json | null
          prompt_tokens: number | null
          prompt_version: string | null
          reasoner: boolean
          response_raw: string | null
          route: string
          total_tokens: number | null
        }
        Insert: {
          ai_recommendation_id?: number | null
          cached?: boolean
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          fixture_id?: number | null
          follow_up?: boolean
          hops?: Json | null
          id?: number
          latency_ms?: number | null
          model: string
          prompt_snapshot?: Json | null
          prompt_tokens?: number | null
          prompt_version?: string | null
          reasoner?: boolean
          response_raw?: string | null
          route: string
          total_tokens?: number | null
        }
        Update: {
          ai_recommendation_id?: number | null
          cached?: boolean
          completion_tokens?: number | null
          cost_usd?: number | null
          created_at?: string
          error?: string | null
          fixture_id?: number | null
          follow_up?: boolean
          hops?: Json | null
          id?: number
          latency_ms?: number | null
          model?: string
          prompt_snapshot?: Json | null
          prompt_tokens?: number | null
          prompt_version?: string | null
          reasoner?: boolean
          response_raw?: string | null
          route?: string
          total_tokens?: number | null
        }
        Relationships: []
      }
      markets: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      model_calibration: {
        Row: {
          created_at: string
          effective_from: string
          effective_until: string | null
          id: number
          metric: string
          model_version: string
          n: number
          pairs: Json
        }
        Insert: {
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: never
          metric: string
          model_version: string
          n: number
          pairs: Json
        }
        Update: {
          created_at?: string
          effective_from?: string
          effective_until?: string | null
          id?: never
          metric?: string
          model_version?: string
          n?: number
          pairs?: Json
        }
        Relationships: []
      }
      sports: {
        Row: {
          created_at: string | null
          id: string
          name: string
          slug: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
          slug: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
          slug?: string
        }
        Relationships: []
      }
      transactions: {
        Row: {
          amount: number
          created_at: string | null
          currency: string
          direction: Database["public"]["Enums"]["transaction_direction"]
          house_id: string
          id: string
          kind: Database["public"]["Enums"]["transaction_kind"]
          metadata: Json | null
          note: string | null
          occurred_at: string
          related_bet_id: string | null
          related_transaction_id: string | null
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string | null
          currency?: string
          direction: Database["public"]["Enums"]["transaction_direction"]
          house_id: string
          id?: string
          kind: Database["public"]["Enums"]["transaction_kind"]
          metadata?: Json | null
          note?: string | null
          occurred_at?: string
          related_bet_id?: string | null
          related_transaction_id?: string | null
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string | null
          currency?: string
          direction?: Database["public"]["Enums"]["transaction_direction"]
          house_id?: string
          id?: string
          kind?: Database["public"]["Enums"]["transaction_kind"]
          metadata?: Json | null
          note?: string | null
          occurred_at?: string
          related_bet_id?: string | null
          related_transaction_id?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "transactions_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "house_balance_view"
            referencedColumns: ["house_id"]
          },
          {
            foreignKeyName: "transactions_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "houses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_house_id_fkey"
            columns: ["house_id"]
            isOneToOne: false
            referencedRelation: "roi_by_house_view"
            referencedColumns: ["house_id"]
          },
          {
            foreignKeyName: "transactions_related_bet_id_fkey"
            columns: ["related_bet_id"]
            isOneToOne: false
            referencedRelation: "bets"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transactions_related_transaction_id_fkey"
            columns: ["related_transaction_id"]
            isOneToOne: false
            referencedRelation: "transactions"
            referencedColumns: ["id"]
          },
        ]
      }
      ui_telemetry: {
        Row: {
          ai_recommendation_id: number | null
          created_at: string
          elapsed_ms: number | null
          event_type: string
          fixture_id: number | null
          id: number
          panel_id: string | null
          payload: Json | null
          session_id: string | null
          user_id: string | null
        }
        Insert: {
          ai_recommendation_id?: number | null
          created_at?: string
          elapsed_ms?: number | null
          event_type: string
          fixture_id?: number | null
          id?: number
          panel_id?: string | null
          payload?: Json | null
          session_id?: string | null
          user_id?: string | null
        }
        Update: {
          ai_recommendation_id?: number | null
          created_at?: string
          elapsed_ms?: number | null
          event_type?: string
          fixture_id?: number | null
          id?: number
          panel_id?: string | null
          payload?: Json | null
          session_id?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      user_profile: {
        Row: {
          created_at: string | null
          default_currency: string
          display_name: string | null
          timezone: string
          updated_at: string | null
          user_id: string
        }
        Insert: {
          created_at?: string | null
          default_currency?: string
          display_name?: string | null
          timezone?: string
          updated_at?: string | null
          user_id: string
        }
        Update: {
          created_at?: string | null
          default_currency?: string
          display_name?: string | null
          timezone?: string
          updated_at?: string | null
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      bet_summary_view: {
        Row: {
          cashout_count: number | null
          lost_count: number | null
          partial_count: number | null
          pending_count: number | null
          pending_stake: number | null
          resolved_returned: number | null
          resolved_staked: number | null
          total_bets: number | null
          user_id: string | null
          void_count: number | null
          won_count: number | null
        }
        Relationships: []
      }
      daily_pl_view: {
        Row: {
          cumulative_pl: number | null
          deposits_to_date: number | null
          pending_stake: number | null
          returned_to_date: number | null
          snapshot_date: string | null
          staked_to_date: number | null
          total_balance: number | null
          user_id: string | null
          withdrawals_to_date: number | null
        }
        Relationships: []
      }
      fixture_badges_view: {
        Row: {
          badges: string[] | null
          fixture_id: number | null
          high_signal: boolean | null
        }
        Relationships: []
      }
      house_balance_view: {
        Row: {
          archived_at: string | null
          balance: number | null
          bet_count: number | null
          color_hex: string | null
          deposits: number | null
          house_id: string | null
          name: string | null
          pending_stake: number | null
          returned: number | null
          slug: string | null
          staked: number | null
          user_id: string | null
          withdrawals: number | null
        }
        Relationships: []
      }
      roi_by_house_view: {
        Row: {
          bet_count: number | null
          color_hex: string | null
          house_id: string | null
          house_name: string | null
          pending_stake: number | null
          pl: number | null
          resolved_returned: number | null
          resolved_staked: number | null
          roi: number | null
          slug: string | null
          user_id: string | null
          win_rate: number | null
          yield: number | null
        }
        Relationships: []
      }
      roi_by_period_view: {
        Row: {
          bet_count: number | null
          lost_count: number | null
          period: string | null
          period_type: string | null
          pl: number | null
          resolved_returned: number | null
          resolved_staked: number | null
          user_id: string | null
          win_rate: number | null
          won_count: number | null
          yield: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      generate_balance_snapshots: { Args: { p_date?: string }; Returns: number }
      match_fixture_fuzzy: {
        Args: { p_home: string; p_away: string; p_kickoff?: string | null }
        Returns: {
          id: number
          home_team: string
          away_team: string
          league: string | null
          country: string | null
          kickoff_utc: string
          confidence: number
        }[]
      }
      house_balance: {
        Args: { p_house_id: string; p_user_id: string }
        Returns: {
          balance: number
          deposits_to_date: number
          pending_stake: number
          returned_to_date: number
          staked_to_date: number
          withdrawals_to_date: number
        }[]
      }
      place_bet: { Args: { p_payload: Json }; Returns: string }
      resolve_bet: {
        Args: {
          p_actual_return?: number
          p_bet_id: string
          p_resolved_at?: string
          p_status: Database["public"]["Enums"]["bet_status"]
        }
        Returns: undefined
      }
    }
    Enums: {
      audit_action: "create" | "update" | "delete" | "soft_delete" | "restore"
      bet_event_type:
        | "placed"
        | "edited"
        | "resolved"
        | "voided"
        | "cashed_out"
        | "reopened"
      bet_kind: "single" | "multiple" | "system"
      bet_status:
        | "pending"
        | "won"
        | "lost"
        | "void"
        | "cashed_out"
        | "half_won"
        | "half_lost"
        | "partially_void"
      transaction_direction: "in" | "out"
      transaction_kind:
        | "deposit"
        | "withdrawal"
        | "bet_stake"
        | "bet_return"
        | "bonus_credit"
        | "bonus_rollover"
        | "fee"
        | "adjustment_credit"
        | "adjustment_debit"
        | "transfer_in"
        | "transfer_out"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {
      audit_action: ["create", "update", "delete", "soft_delete", "restore"],
      bet_event_type: [
        "placed",
        "edited",
        "resolved",
        "voided",
        "cashed_out",
        "reopened",
      ],
      bet_kind: ["single", "multiple", "system"],
      bet_status: [
        "pending",
        "won",
        "lost",
        "void",
        "cashed_out",
        "half_won",
        "half_lost",
        "partially_void",
      ],
      transaction_direction: ["in", "out"],
      transaction_kind: [
        "deposit",
        "withdrawal",
        "bet_stake",
        "bet_return",
        "bonus_credit",
        "bonus_rollover",
        "fee",
        "adjustment_credit",
        "adjustment_debit",
        "transfer_in",
        "transfer_out",
      ],
    },
  },
} as const
