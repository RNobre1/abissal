// Helper de auth para READ-PATHS (Server Components, GET handlers).
//
// `authedUserId` obtém o id do usuário via `getClaims()` — que, com chaves JWT
// assimétricas (ES256), verifica a assinatura do token LOCALMENTE (WebCrypto +
// JWKS cacheado), SEM round-trip à Auth do Supabase. O middleware já garantiu a
// sessão antes da página/handler rodar, então aqui só precisamos do `sub`.
//
// Para MUTAÇÕES sensíveis (escrita de banca: apostas, transações, casas) use
// `supabase.auth.getUser()` diretamente — a validação server-side completa
// (round-trip) vale a garantia extra num write-path. Ver Lição B22.

/** Forma mínima necessária: um client capaz de `getClaims()`. */
export interface ClaimsCapable {
  auth: {
    getClaims(): Promise<{
      data: { claims?: { sub?: string | null } | null } | null;
      error: unknown;
    }>;
  };
}

/**
 * @returns o `sub` (id do usuário) validado localmente, ou `null` se não há
 * sessão válida. O call-site decide a reação (redirect, 401, ou seguir).
 */
export async function authedUserId(
  supabase: ClaimsCapable,
): Promise<string | null> {
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  return typeof sub === "string" && sub.length > 0 ? sub : null;
}
