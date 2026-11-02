import { NextResponse, type NextRequest } from 'next/server';
import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server';
import { websiteOnlyEnabled, websiteReleaseDecision } from '@/lib/website-release';
import { reviewModeEnabled, reviewProxy } from '@/server/review-auth';
import { nativeAuthEnabled } from '@/server/auth/mode';
import { getSessionCookie } from 'better-auth/cookies';
import { nativeApiRouteAllowed } from '@/server/auth/native-api-routes';

/**
 * Proxy (Next 16 renamed Middleware → Proxy). OPTIMISTIC redirect only.
 *
 * The Next docs are explicit that Proxy "should not be used as a full session
 * management or authorization solution" — so the authoritative gate is
 * `requireCapability()` in each page and `assertCan()` in every server action.
 * This file does nothing but keep unauthenticated deep-links tidy once real auth
 * lands; today, with the dev identity always present, it is a pass-through.
 */
const isPublic = createRouteMatcher(['/', '/login(.*)', '/sign-up(.*)', '/api/v1/health', '/api/webhooks(.*)', '/api/construction/transmittals/acknowledge', '/construction/transmittals/acknowledge', '/api/construction/digest/acknowledge', '/construction/digest/acknowledge', '/robots.txt', '/sitemap.xml']);
const clerkProxy = clerkMiddleware(async (auth, request) => {
  if (!isPublic(request)) await auth.protect();
});

export function proxy(request: NextRequest, event: Parameters<typeof clerkProxy>[1]): ReturnType<typeof clerkProxy> {
  if (reviewModeEnabled()) return reviewProxy(request);
  const release = websiteReleaseDecision({
    flag: process.env.PROPBREW_WEBSITE_ONLY,
    nodeEnv: process.env.NODE_ENV,
    method: request.method,
    pathname: request.nextUrl.pathname,
  });
  if (release.kind === 'deny') {
    return new NextResponse(release.status === 405 ? 'Read-only website' : 'Not found', {
      status: release.status,
      headers: { 'Cache-Control': 'no-store', ...(release.status === 405 ? { Allow: release.allow } : {}) },
    });
  }
  if (release.kind === 'redirect') return NextResponse.redirect(new URL(release.location, request.url), release.status);
  if (websiteOnlyEnabled(process.env.PROPBREW_WEBSITE_ONLY, process.env.NODE_ENV)) return NextResponse.next();
  const pathname = request.nextUrl.pathname;
  if (pathname === '/' && (request.method === 'GET' || request.method === 'HEAD')) {
    const response = NextResponse.redirect(new URL('/login', request.url), 307);
    response.headers.set('Cache-Control', 'no-store');
    return response;
  }
  if (pathname.startsWith('/_next/static/') || pathname === '/_next/image' || pathname.startsWith('/brand/') || pathname === '/icon.svg' || pathname === '/favicon.ico') return NextResponse.next();
  if (nativeAuthEnabled()) {
    if (pathname.startsWith('/review/')) return new NextResponse('Not found',{status:404});
    if(pathname.startsWith('/api/')) {
      // Legacy mobile/provider endpoints stay closed until company-aware.
      if (nativeApiRouteAllowed(pathname)) return NextResponse.next();
      return new NextResponse('Not found',{status:404,headers:{'Cache-Control':'no-store'}});
    }
    const publicPage=pathname==='/'||pathname==='/mobile'||pathname==='/login'||pathname.startsWith('/login/')||pathname==='/sign-up'||pathname.startsWith('/sign-up/')||pathname.startsWith('/invite/')||pathname==='/construction/transmittals/acknowledge'||pathname==='/construction/digest/acknowledge'||pathname==='/robots.txt'||pathname==='/sitemap.xml';
    if(!publicPage&&!getSessionCookie(request,{cookiePrefix:'propbrew'}))return NextResponse.redirect(new URL('/login',request.url));
    return NextResponse.next();
  }
  if (process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) return clerkProxy(request, event);
  return NextResponse.next();
}

export const config = {
  // Website-only releases must also reject writes to the homepage and assets.
  matcher: ['/:path*'],
};
