import { describe, expect, it } from 'vitest';
import { POST } from '@/app/api/construction/digest/acknowledge/route';

describe('public weekly digest receipt form', () => {
  it('rejects an invalid signed token without requiring browser Origin headers', async () => {
    const request = new Request('https://app.usepropbrew.com/api/construction/digest/acknowledge', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'token=invalid&name=Pilot+Operator&organisation=Propbrew+QA&confirmed=yes',
    });
    const response = await POST(request);
    expect(response.status).toBe(400);
    expect(await response.text()).toMatch(/invalid or expired/i);
  });
});
