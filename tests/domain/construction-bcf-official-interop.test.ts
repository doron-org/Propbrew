import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseBcfZip } from '@/domain/construction/bcf';

const root = fileURLToPath(new URL('../fixtures/construction/bcf-v3-official/', import.meta.url));
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  });
}
const cases = files(root).filter((path) => path.toLowerCase().endsWith('.bcf') && !relative(root, path).split('/').includes('unzipped')).sort();
const folderMismatch = 'Visualization/Single invisible wall/single invisible wall.bcf';

describe('buildingSMART BCF 3.0 official interoperability fixtures', () => {
  it('keeps the complete, unmodified 19-case official set', () => {
    expect(cases).toHaveLength(19);
  });

  it('rejects the official sample whose topic GUID does not match its topic folder', () => {
    // Upstream folder e1fff3a6… contains topic d5121f1c…. BCF-XML Documentation
    // §Topic folder structure requires the folder name to be the topic GUID.
    expect(() => parseBcfZip(new Uint8Array(readFileSync(join(root, folderMismatch)))))
      .toThrow(/topic identifier is invalid, repeated or does not match its folder/);
  });

  for (const path of cases.filter((candidate) => relative(root, candidate) !== folderMismatch)) {
    it(`imports ${relative(root, path)}`, () => {
      const topics = parseBcfZip(new Uint8Array(readFileSync(path)));
      expect(topics.length).toBeGreaterThan(0);
      for (const topic of topics) {
        expect(topic.guid).toMatch(/^[0-9a-f-]{36}$/);
        expect(topic.title.length).toBeGreaterThanOrEqual(4);
        expect(topic.createdAtISO).toBe(new Date(topic.createdAtISO).toISOString());
        for (const viewpoint of topic.viewpoints ?? []) {
          expect(viewpoint.guid).toMatch(/^[0-9a-f-]{36}$/);
          if (viewpoint.fileName) expect(viewpoint.camera).toBeDefined();
          if (viewpoint.snapshot) expect(viewpoint.snapshot.base64.length).toBeGreaterThan(0);
        }
      }
    });
  }
});
