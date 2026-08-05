import { NextRequest, NextResponse } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth";

// Checagem otimista, só pelo cookie (sem banco) — a validação autoritativa
// fica no DAL (getSession) e dentro de cada Server Action.
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const payload = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname.startsWith("/admin") && pathname !== "/admin/login" && payload?.role !== "admin") {
    const url = request.nextUrl.clone();
    url.pathname = "/admin/login";
    url.search = "";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/perfil") && !payload) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/perfil/:path*"],
};
