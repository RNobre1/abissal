import { z } from "zod";

export const ParsedLegSchema = z.object({
  home: z.string().min(1),
  away: z.string().min(1),
  market: z.string().min(1), // "1X2", "Over/Under 2.5", "BTTS", "Asian Handicap -0.5" etc
  side: z.string().min(1), // "Home", "Over", "Yes", "Home -0.5" etc
  odd_taken: z.number().positive().nullable(),
  league: z.string().nullable(),
  kickoff_iso: z.string().nullable(), // ISO 8601 UTC se possível, senão null
});

export const ParsedSlipSchema = z.object({
  legs: z.array(ParsedLegSchema).min(1),
  stake_total: z.number().positive().nullable(),
  odd_combined: z.number().positive().nullable(),
  house_detected: z.string().nullable(), // "superbet", "bet365", "betano", null
  is_bet_builder: z.boolean().default(false),
});

export type ParsedLeg = z.infer<typeof ParsedLegSchema>;
export type ParsedSlip = z.infer<typeof ParsedSlipSchema>;
