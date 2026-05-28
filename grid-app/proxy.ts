import { type NextRequest, NextResponse } from "next/server"
import { createServerClient } from "@supabase/ssr"

// Next.js 16 renamed `middleware` to `proxy`. Same wiring; refreshes the
// Supabase session cookies on every request and guards /app/** routes.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const path = request.nextUrl.pathname
  const isAppRoute =
    path.startsWith("/app") ||
    path.startsWith("/api/opencode") ||
    path.startsWith("/api/artifacts") ||
    path.startsWith("/api/chats") ||
    path.startsWith("/api/features") ||
    path.startsWith("/api/upload") ||
    path.startsWith("/api/fetch") ||
    path.startsWith("/api/orgs") ||
    path.startsWith("/api/review-policy") ||
    path.startsWith("/api/settings") ||
    path.startsWith("/api/admin")
  const isAuthRoute = path === "/login" || path === "/signup"
  const isRoot = path === "/"

  if (!user && (isAppRoute || isRoot)) {
    const url = request.nextUrl.clone()
    url.pathname = "/login"
    if (isAppRoute) url.searchParams.set("next", path)
    return NextResponse.redirect(url)
  }

  if (user && (isAuthRoute || isRoot)) {
    const url = request.nextUrl.clone()
    url.pathname = "/app"
    return NextResponse.redirect(url)
  }

  return response
}

export const config = {
  matcher: [
    "/",
    "/((?!_next/static|_next/image|favicon\\.ico|favicon\\.png|spi-mark.*|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
