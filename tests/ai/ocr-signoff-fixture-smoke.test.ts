/** Deterministic smoke check for the sign-off fixtures — no AI calls. */
import { describe, expect, it } from 'vitest';
import { buildSyntheticDocs } from './ocr-signoff-drawing-factory';
import { extractConstructionPdfForIndex } from '@/server/construction/document-text';

describe('OCR sign-off fixtures', () => {
  it('produces raster-only PDFs that force the OCR path', async () => {
    const docs = await buildSyntheticDocs();
    expect(docs).toHaveLength(3);
    for (const doc of docs) {
      expect(doc.pdf.byteLength).toBeGreaterThan(1000);
      doc.pngs.forEach((png) => expect(png.subarray(0, 4)).toEqual(Buffer.from([137, 80, 78, 71])));
      const extracted = await extractConstructionPdfForIndex(doc.pdf); // no ocrPage — text layer only
      expect(extracted.pageCount).toBe(doc.pages.length);
      for (const page of extracted.pages) {
        // Below the 120-char threshold so production code marks pages pending OCR.
        expect(page.text.length, `${doc.number} page ${page.page} must not have a useful text layer`).toBeLessThan(120);
      }
    }
  }, 120_000);
});
