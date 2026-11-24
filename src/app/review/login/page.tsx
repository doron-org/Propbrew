import { cookies } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { LockKeyhole } from 'lucide-react';
import { getReviewSession, REVIEW_CSRF_COOKIE, reviewModeEnabled } from '@/server/review-auth';
import { durableRecordsEnabled } from '@/server/data/record-context';

export const dynamic = 'force-dynamic';

export default async function ReviewLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (!reviewModeEnabled()) notFound();
  if (await getReviewSession()) redirect('/workspaces');
  const csrf = (await cookies()).get(REVIEW_CSRF_COOKIE)?.value ?? '';
  const failed = (await searchParams).error === 'invalid';
  const persistent = durableRecordsEnabled();
  return (
    <main className="pb-app bg-app text-text min-h-[calc(100dvh-var(--review-banner-height,0px))] flex items-center justify-center p-5">
      <section aria-labelledby="review-title" className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-7 shadow-card">
        <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-white"><LockKeyhole size={21} aria-hidden="true" /></span>
        <p className="text-[12px] font-semibold text-primary">Propbrew · Private review</p>
        <h1 id="review-title" className="mt-2 text-[26px] font-semibold tracking-tight">Enter the review workspace</h1>
        <p className="mt-3 text-sm leading-relaxed text-text-2">Use the password shared with you to explore Property Management, Shortlet and Construction with sample records and AI Copilots.</p>
        <form method="post" action="/review/login/auth" className="mt-6">
          <input type="hidden" name="csrf" value={csrf} />
          <label htmlFor="review-password" className="pb-form-label">Review password</label>
          <input id="review-password" name="password" type="password" autoComplete="current-password" required maxLength={1024} aria-invalid={failed ? true : undefined} aria-describedby={failed ? 'review-error' : undefined} className="pb-form-control propbrew-review-password min-h-11 text-base" />
          {failed && <p id="review-error" role="alert" className="mt-2 text-sm text-danger">That password was not accepted. Please try again.</p>}
          <button type="submit" className="pb-action propbrew-review-submit mt-5 min-h-11 w-full bg-primary">Open private review</button>
        </form>
        <p className="mt-5 text-xs leading-relaxed text-text-3">{persistent ? 'This is a shared review account. Sample changes are saved to the database. Do not enter customer information.' : 'This is a shared review account. Sample changes reset when the service restarts. Do not enter customer information.'}</p>
      </section>
    </main>
  );
}
