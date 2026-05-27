import { describe, it, expect } from "vitest";
import { ParsedLegSchema, ParsedSlipSchema } from "@/lib/bet-slip-ocr/schema";

describe("ParsedLegSchema", () => {
  const validLeg = {
    home: "Flamengo",
    away: "Palmeiras",
    market: "1X2",
    side: "Casa",
    odd_taken: 2.1,
    league: "Brasileirão Série A",
    kickoff_iso: "2026-05-26T22:00:00Z",
  };

  it("aceita leg válida completa", () => {
    const result = ParsedLegSchema.safeParse(validLeg);
    expect(result.success).toBe(true);
  });

  it("aceita leg com league e kickoff_iso nulos", () => {
    const result = ParsedLegSchema.safeParse({
      ...validLeg,
      league: null,
      kickoff_iso: null,
    });
    expect(result.success).toBe(true);
  });

  it("aceita odd_taken null (bet builder — sem odd individual por leg)", () => {
    const result = ParsedLegSchema.safeParse({ ...validLeg, odd_taken: null });
    expect(result.success).toBe(true);
  });

  it("rejeita odd_taken negativo", () => {
    const result = ParsedLegSchema.safeParse({ ...validLeg, odd_taken: -1.5 });
    expect(result.success).toBe(false);
  });

  it("rejeita odd_taken zero", () => {
    const result = ParsedLegSchema.safeParse({ ...validLeg, odd_taken: 0 });
    expect(result.success).toBe(false);
  });

  it("rejeita home vazio", () => {
    const result = ParsedLegSchema.safeParse({ ...validLeg, home: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita away vazio", () => {
    const result = ParsedLegSchema.safeParse({ ...validLeg, away: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita market vazio", () => {
    const result = ParsedLegSchema.safeParse({ ...validLeg, market: "" });
    expect(result.success).toBe(false);
  });

  it("rejeita side vazio", () => {
    const result = ParsedLegSchema.safeParse({ ...validLeg, side: "" });
    expect(result.success).toBe(false);
  });
});

describe("ParsedSlipSchema", () => {
  const validLeg = {
    home: "Flamengo",
    away: "Palmeiras",
    market: "1X2",
    side: "Casa",
    odd_taken: 2.1,
    league: null,
    kickoff_iso: null,
  };

  it("aceita slip válido com 1 leg", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [validLeg],
      stake_total: 50,
      odd_combined: 2.1,
      house_detected: "superbet",
    });
    expect(result.success).toBe(true);
  });

  it("aceita slip com 3 legs", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [validLeg, validLeg, validLeg],
      stake_total: 100,
      odd_combined: 9.26,
      house_detected: "bet365",
    });
    expect(result.success).toBe(true);
  });

  it("rejeita slip com legs vazio (min 1)", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [],
      stake_total: 50,
      odd_combined: null,
      house_detected: null,
    });
    expect(result.success).toBe(false);
  });

  it("aceita house_detected null", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [validLeg],
      stake_total: null,
      odd_combined: null,
      house_detected: null,
    });
    expect(result.success).toBe(true);
  });

  it("aceita stake_total null", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [validLeg],
      stake_total: null,
      odd_combined: 2.1,
      house_detected: "betano",
    });
    expect(result.success).toBe(true);
  });

  it("aceita odd_combined null", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [validLeg],
      stake_total: 50,
      odd_combined: null,
      house_detected: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejeita stake_total negativo", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [validLeg],
      stake_total: -10,
      odd_combined: null,
      house_detected: null,
    });
    expect(result.success).toBe(false);
  });

  it("is_bet_builder default false quando ausente", () => {
    const result = ParsedSlipSchema.safeParse({
      legs: [validLeg],
      stake_total: null,
      odd_combined: 2.1,
      house_detected: null,
      // is_bet_builder ausente
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_bet_builder).toBe(false);
    }
  });

  it("aceita is_bet_builder: true com legs de odd_taken null", () => {
    const builderLeg = { ...validLeg, odd_taken: null };
    const result = ParsedSlipSchema.safeParse({
      legs: [builderLeg, builderLeg],
      stake_total: 20,
      odd_combined: 4.5,
      house_detected: "betano",
      is_bet_builder: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.is_bet_builder).toBe(true);
      expect(result.data.legs[0].odd_taken).toBeNull();
      expect(result.data.legs[1].odd_taken).toBeNull();
    }
  });
});
