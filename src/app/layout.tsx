import type { Metadata } from 'next';
import Script from 'next/script';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { ThemeProvider, themeInitScript } from '@/components/theme-provider';
import { brand } from '@/config/brand';
import { ClerkProvider } from '@clerk/nextjs';
import { clerkConfigured } from '@/server/onboarding/identity';
import { websiteOnlyEnabled } from '@/lib/website-release';
import { reviewModeEnabled } from '@/server/review-auth';
import { durableRecordsEnabled } from '@/server/data/record-context';
import './globals.css';
import './review.css';
import '@/components/ui/application-foundations.css';
import '@/components/ui/operational-surfaces.css';

// Inter remains a resilient fallback while Propbrew's licensed Neue Jothama
// variable face is self-hosted through globals.css (no third-party request).
const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin', 'latin-ext'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  variable: '--font-jetbrains-mono',
  subsets: ['latin'],
  weight: ['400', '500'],
});

export const metadata: Metadata = {
  title: `${brand.name} — ${brand.tagline}`,
  description: 'Propbrew connects property operations and communities in one intelligent workspace. Built for Nigeria and a brighter property future.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const review = reviewModeEnabled();
  const persistent = durableRecordsEnabled();
  const authEnabled = !review && clerkConfigured() && !websiteOnlyEnabled(process.env.PROPBREW_WEBSITE_ONLY, process.env.NODE_ENV);
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col" data-private-review={review ? 'true' : undefined}>
        {review && <aside role="note" aria-label="Private review environment" className="propbrew-review-banner"><strong>{persistent ? 'Database-backed review' : 'Private review'}</strong><span>{persistent ? 'Sample records · Saved to database · Do not enter customer information.' : 'Sample data · Changes reset on restart · Do not enter customer information.'}</span></aside>}
        {/* Runs before paint so the persisted theme never flashes. `next/script`
            with beforeInteractive is injected by Next into the document head and
            avoids React's "script tag in component" warning. */}
        <Script id="theme-init" strategy="beforeInteractive">
          {themeInitScript}
        </Script>
        {/* AppShell now lives in each authenticated route group's layout, so the
            root layout carries only fonts, theme init and globals. */}
        {authEnabled ? (
          <ClerkProvider signInUrl="/login" signUpUrl="/sign-up" signInFallbackRedirectUrl="/auth/continue" signUpForceRedirectUrl="/onboarding">
            <ThemeProvider>{children}</ThemeProvider>
          </ClerkProvider>
        ) : <ThemeProvider>{children}</ThemeProvider>}
      </body>
    </html>
  );
}
