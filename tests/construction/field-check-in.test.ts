import { describe, expect, it } from 'vitest';
import { assessFieldCheckIn } from '@/domain/construction/field-check-in';

const site = { id: 'site-lagos', name: 'Lagos site', kind: 'site' as const, latitude: 6.5244, longitude: 3.3792 };
const captured = '2026-11-01T08:00:00.000Z';
const fix = { latitude: 6.5245, longitude: 3.3792, accuracyMeters: 14, locationAtISO: captured };

describe('construction device location attestation', () => {
  it('accepts a fresh accurate fix near a configured site and dates it in Nigeria', () => {
    expect(assessFieldCheckIn(fix, captured, '2026-11-01T08:01:00.000Z', [site])).toMatchObject({ ok: true, siteLocationId: site.id, dateISO: '2026-11-01' });
  });
  it('refuses a distant site, low accuracy, stale fix, old offline capture and missing site coordinates', () => {
    expect(assessFieldCheckIn({ ...fix, latitude: 6.53 }, captured, '2026-11-01T08:01:00.000Z', [site])).toMatchObject({ ok: false });
    expect(assessFieldCheckIn({ ...fix, accuracyMeters: 150 }, captured, '2026-11-01T08:01:00.000Z', [site])).toMatchObject({ ok: false });
    expect(assessFieldCheckIn({ ...fix, locationAtISO: '2026-11-01T07:50:00.000Z' }, captured, '2026-11-01T08:01:00.000Z', [site])).toMatchObject({ ok: false });
    expect(assessFieldCheckIn(fix, captured, '2026-11-10T08:01:00.000Z', [site])).toMatchObject({ ok: false });
    expect(assessFieldCheckIn(fix, captured, '2026-11-01T08:01:00.000Z', [])).toMatchObject({ ok: false });
  });
});
