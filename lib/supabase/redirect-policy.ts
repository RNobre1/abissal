// Política de redirect do middleware (frente E — landing pré-login).
// Função PURA (testável sem mockar Supabase): decide pra onde redirecionar,
// ou null pra seguir. O updateSession resolve a sessão e delega aqui.

/** Prefixos sempre públicos (não forçam login). */
const PUBLIC_PREFIXES = ["/login", "/brand", "/_next", "/favicon.ico"];

/** Home do app autenticado (a landing assume a raiz "/"). */
export const APP_HOME = "/painel";

function isPublic(pathname: string): boolean {
  // "/" é a landing pública (match exato — startsWith("/") pegaria tudo).
  if (pathname === "/") return true;
  return PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));
}

/**
 * @returns destino do redirect, ou `null` pra deixar passar.
 */
export function decideRedirect(
  pathname: string,
  isAuthed: boolean,
): string | null {
  if (isAuthed) {
    // Já logado: tira da landing e do login, manda pro app.
    if (pathname === "/" || pathname === "/login") return APP_HOME;
    return null;
  }
  // Deslogado: rota pública passa; o resto vai pro login.
  return isPublic(pathname) ? null : "/login";
}
