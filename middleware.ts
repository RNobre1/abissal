import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - api/* (route handlers — no Supabase Auth round-trip needed)
     * - _next/static, _next/image (optimized assets)
     * - favicon.ico, robots.txt, sitemap.xml
     * - public files (svg, png, jpg, etc.)
     *
     * Wave C perf: excluding /api/* eliminates a redundant Supabase Auth
     * session read on every API request (route handlers use createAdminClient
     * or createClient() independently when they need auth).
     */
    "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\.(?:svg|png|jpg|jpeg|gif|webp|woff|woff2)$).*)",
  ],
};
