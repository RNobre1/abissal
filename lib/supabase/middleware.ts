import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import type { Database } from "@/lib/supabase/types";
import { decideRedirect } from "@/lib/supabase/redirect-policy";

type CookieToSet = { name: string; value: string; options: CookieOptions };

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: CookieToSet[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // getClaims valida o JWT LOCALMENTE quando o projeto usa chaves assimétricas
  // (ES256) — sem round-trip à Auth do Supabase a cada navegação (era getUser,
  // que sempre fazia POST /auth/v1/user). O refresh de token expirado é
  // preservado: getClaims → getSession → _callRefreshToken → re-set dos cookies
  // via setAll. Recomendação oficial do Supabase p/ proteger páginas no SSR.
  const { data } = await supabase.auth.getClaims();

  const dest = decideRedirect(request.nextUrl.pathname, Boolean(data?.claims));
  if (dest) {
    const url = request.nextUrl.clone();
    url.pathname = dest;
    return NextResponse.redirect(url);
  }

  return response;
}
