import type { NextConfig } from 'next';
import { contentSecurityPolicy } from './src/lib/security-headers';
import { websiteOnlyEnabled } from './src/lib/website-release';

/**
 * Security response headers.
 *
 * This file was empty, so the app shipped with no CSP, no clickjacking
 * protection and no MIME-sniffing protection. These are cheap, apply to every
 * route, and are the baseline any reachable deployment needs.
 *
 * The CSP allows 'unsafe-inline' for styles because the app sets CSS custom
 * properties inline throughout, and Google Fonts for the marketing page. Script
 * is restricted to self; 'unsafe-inline' is required for Next's bootstrap and
 * the pre-paint theme script, which runs before hydration to avoid a flash.
 */
const clerkEnabled = Boolean(process.env.CLERK_SECRET_KEY && process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY)
  && !websiteOnlyEnabled(process.env.PROPBREW_WEBSITE_ONLY, process.env.NODE_ENV);
// React/webpack development debugging requires eval; production keeps it disabled.
const csp = contentSecurityPolicy(clerkEnabled ? process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY : undefined, process.env.NODE_ENV);

const nextConfig: NextConfig = {
  serverExternalPackages: ['web-ifc', 'pdfjs-dist', '@napi-rs/canvas'],
  poweredByHeader: false,
  // Next's development action tracing includes arguments (property addresses).
  // Keep normal request/error logs, but never print raw form payloads.
  logging: { serverFunctions: false },
  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
          { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
        ],
      },
    ]);
  },
};

export default nextConfig;
