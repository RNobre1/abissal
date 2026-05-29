/**
 * Política de redirect do middleware (frente E — landing).
 * Função pura: dado (pathname, isAuthed), decide o destino do redirect ou null.
 * Regras:
 *  - "/" é a landing pública: deslogado vê; logado vai direto pro /painel.
 *  - rotas públicas (/login, /brand, _next, favicon): nunca forçam login.
 *  - rota protegida + deslogado → /login.
 *  - /login + logado → /painel.
 */

import { describe, expect, it } from "vitest";
import { decideRedirect } from "@/lib/supabase/redirect-policy";

describe("decideRedirect", () => {
  it("landing (/) é pública pra deslogado", () => {
    expect(decideRedirect("/", false)).toBeNull();
  });

  it("logado na landing vai direto pro /painel", () => {
    expect(decideRedirect("/", true)).toBe("/painel");
  });

  it("rota protegida + deslogado → /login", () => {
    expect(decideRedirect("/painel", false)).toBe("/login");
    expect(decideRedirect("/fixtures", false)).toBe("/login");
    expect(decideRedirect("/banca", false)).toBe("/login");
  });

  it("rota protegida + logado → segue (null)", () => {
    expect(decideRedirect("/painel", true)).toBeNull();
    expect(decideRedirect("/fixtures", true)).toBeNull();
  });

  it("/login + logado → /painel (sai do login)", () => {
    expect(decideRedirect("/login", true)).toBe("/painel");
  });

  it("/login + deslogado → segue (null)", () => {
    expect(decideRedirect("/login", false)).toBeNull();
  });

  it("rotas públicas (brand, _next, favicon) nunca forçam login", () => {
    expect(decideRedirect("/brand", false)).toBeNull();
    expect(decideRedirect("/_next/static/chunk.js", false)).toBeNull();
    expect(decideRedirect("/favicon.ico", false)).toBeNull();
  });
});
