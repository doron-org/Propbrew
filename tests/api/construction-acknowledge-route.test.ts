import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/construction/transmittals/acknowledge/route';

describe('public construction receipt form', () => {
  it('rejects an invalid signed token without relying on browser Origin headers', async () => {
    const request = new Request('https://app.usepropbrew.com/api/construction/transmittals/acknowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=invalid&name=Pilot+Operator&organisation=Propbrew+QA&confirmed=yes',
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/invalid or expired/i);
  });
});
