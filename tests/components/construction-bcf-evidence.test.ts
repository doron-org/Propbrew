import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BcfIssueEvidence } from '@/components/construction/quality/bcf-issue-evidence';
import type { Issue } from '@/domain/construction/types';

describe('Construction BCF issue review', () => {
  it('renders a scoped snapshot, all viewpoint metadata, external comments and activity history', () => {
    const bcf: NonNullable<Issue['bcf']> = { guid: '12345678-1234-4234-8234-123456789abc', externalStatus: 'InProgress',
      createdAtISO: '2026-10-31T10:00:00.000Z', createdAuthor: 'Consultant A',
      viewpoints: [{ guid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', fileName: 'view.bcfv', componentIds: ['0sfBnoLAb0R9H9P$iaZWyE'],
        xml: '<VisualizationInfo><ClippingPlanes/></VisualizationInfo>',
        camera: { kind: 'Perspective', position: [1, 2, 3], direction: [0, 0, -1], up: [0, 1, 0], aspectRatio: 1.6, fieldOfView: 60 },
        snapshot: { fileName: 'view.png', mediaType: 'image/png', base64: '' } }],
      comments: [{ guid: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', dateISO: '2026-10-31T10:30:00.000Z', author: 'Consultant A', text: 'Please reroute the duct.' }],
      exchangeHistory: [{ atISO: '2026-10-31T11:00:00.000Z', actor: 'Site manager', action: 'imported', commentCount: 1, viewpointCount: 1, status: 'InProgress' }] };
    const html = renderToStaticMarkup(createElement(BcfIssueEvidence, { issueId: 'is-bcf-12345678-1234-4234-8234-123456789abc', bcf, history: [] }));
    expect(html).toContain('/api/construction/bcf/snapshots/is-bcf-12345678-1234-4234-8234-123456789abc/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(html).toContain('Please reroute the duct.');
    expect(html).toContain('Full viewpoint data');
    expect(html).toContain('ClippingPlanes');
    expect(html).toContain('BCF imported');
  });
});
