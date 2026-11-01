import { describe, expect, it } from 'vitest';
import { nativeApiRouteAllowed } from '@/server/auth/native-api-routes';

describe('native API proxy allowlist', () => {
  it('allows the construction upload and a single drawing download', () => {
    expect(nativeApiRouteAllowed('/api/construction/drawings')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/drawings/00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/handover/chp-00000000-0000-4000-8000-000000000000')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/transmittals')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/transmittals/acknowledge')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/transmittals/tr-new-42/retry')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/reports/export')).toBe(true);
    expect(nativeApiRouteAllowed('/api/mobile/v1/construction/bootstrap')).toBe(true);
    expect(nativeApiRouteAllowed('/api/mobile/v1/construction/sync')).toBe(true);
    expect(nativeApiRouteAllowed('/api/mobile/v1/construction/upload')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/evidence/sync-0123456789abcdef0123456789abcdef/0')).toBe(true);
    expect(nativeApiRouteAllowed('/api/construction/field-photos/00000000-0000-4000-8000-000000000000')).toBe(true);
  });

  it('keeps unrelated or malformed API paths closed', () => {
    expect(nativeApiRouteAllowed('/api/construction/drawings/../../admin')).toBe(false);
    expect(nativeApiRouteAllowed('/api/construction/handover/../../admin')).toBe(false);
    expect(nativeApiRouteAllowed('/api/construction/drawings/00000000-0000-4000-8000-000000000000/extra')).toBe(false);
    expect(nativeApiRouteAllowed('/api/construction/transmittals/tr-new-42/../../admin')).toBe(false);
    expect(nativeApiRouteAllowed('/api/construction/evidence/sync-0123456789abcdef0123456789abcdef/../../admin')).toBe(false);
    expect(nativeApiRouteAllowed('/api/construction/evidence/sync-0123456789abcdef0123456789abcdef/20')).toBe(false);
    expect(nativeApiRouteAllowed('/api/construction/field-photos/../../admin')).toBe(false);
    expect(nativeApiRouteAllowed('/api/finance/settlements')).toBe(false);
    expect(nativeApiRouteAllowed('/api/facility/evidence')).toBe(true);
  });
});
