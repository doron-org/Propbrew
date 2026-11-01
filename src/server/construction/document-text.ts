import 'server-only';
import { currentRecordContext } from '@/server/data/record-context';
import type { Actor } from '@/lib/authz';
import type { ConstructionDoc } from '@/domain/construction/types';
import type { PDFPageProxy } from 'pdfjs-dist';

export type PageText = { page: number; text: string; method?: 'text' | 'ocr' };
export type Entry = { tenantId: string; projectId: string; docId: string; fileId: string; sha256: string; pages: PageText[]; extractedAtISO: string; pendingPages?: number[]; pageCount?: number };
type Index = { entries: Entry[] };
const MAX_PAGES = 80;
const MAX_PAGE_TEXT = 3000;
const MAX_INDEX_TEXT = 60000;

function index(write = false): Index {
  const context = currentRecordContext();
  if (!context) return { entries: [] };
  if (write && context.mode !== 'write') throw new Error('Document indexing requires a write transaction.');
  const value = context.state.auxiliary.constructionDocumentText as Index | undefined;
  if (!value) return write ? context.state.auxiliary.constructionDocumentText = { entries: [] } : { entries: [] };
  if (!Array.isArray(value.entries)) throw new Error('Document text index is unavailable.');
  return value;
}

/** PDF text and bounded, explicit OCR of pages without a useful text layer. */
export async function extractConstructionPdfForIndex(bytes: Uint8Array, options: {
  ocrPage?: (png: Uint8Array, page: number) => Promise<string>;
  maxOcrPages?: number;
  existing?: Entry;
} = {}): Promise<{ pages: PageText[]; pendingPages: number[]; pageCount: number; ocrErrors: number }> {
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, disableFontFace: true });
  const pdf = await loading.promise;
  try {
    const pages: PageText[] = [...(options.existing?.pages ?? [])];
    const pendingPages: number[] = [];
    let total = pages.reduce((sum, row) => sum + row.text.length, 0);
    let ocrCount = 0, ocrErrors = 0;
    const pageCount = Math.min(pdf.numPages, MAX_PAGES);
    for (let page = 1; page <= pageCount; page++) {
      const previous = pages.find((row) => row.page === page);
      if (previous && !options.existing?.pendingPages?.includes(page)) continue;
      const pdfPage = await pdf.getPage(page);
      const content = await pdfPage.getTextContent();
      const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim().slice(0, MAX_PAGE_TEXT);
      // A selectable title block does not mean the raster plan is searchable.
      if (text.length >= 120) { if (!previous && total + text.length <= MAX_INDEX_TEXT) { pages.push({ page, text, method: 'text' }); total += text.length; } continue; }
      if (text && !previous && total + text.length <= MAX_INDEX_TEXT) { pages.push({ page, text, method: 'text' }); total += text.length; }
      if (!options.ocrPage || ocrCount >= Math.min(options.maxOcrPages ?? 0, 5) || total >= MAX_INDEX_TEXT) { pendingPages.push(page); continue; }
      ocrCount++;
      try {
        const png = await renderPdfPageForOcr(pdfPage);
        const recognized = (await options.ocrPage(png, page)).replace(/\s+/g, ' ').trim().slice(0, Math.min(MAX_PAGE_TEXT, MAX_INDEX_TEXT - total));
        if (recognized.length >= 12) {
          const combined = text && !recognized.toLowerCase().includes(text.toLowerCase()) ? `${text} ${recognized}`.slice(0, MAX_PAGE_TEXT) : recognized;
          const at = pages.findIndex((row) => row.page === page);
          if (at >= 0) pages[at] = { page, text: combined, method: 'ocr' }; else pages.push({ page, text: combined, method: 'ocr' });
          total += combined.length - (previous?.text.length ?? text.length);
        }
        else pendingPages.push(page);
      } catch { ocrErrors++; pendingPages.push(page); }
    }
    return { pages: pages.sort((a, b) => a.page - b.page), pendingPages, pageCount, ocrErrors };
  } finally { await loading.destroy(); }
}

export async function extractConstructionPdfText(bytes: Uint8Array): Promise<PageText[]> {
  return (await extractConstructionPdfForIndex(bytes)).pages;
}

async function renderPdfPageForOcr(page: PDFPageProxy): Promise<Uint8Array> {
  const { createCanvas } = await import('@napi-rs/canvas');
  const original = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 1800 / Math.max(original.width, original.height));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.max(1, Math.ceil(viewport.width)), Math.max(1, Math.ceil(viewport.height)));
  const context = canvas.getContext('2d');
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context as never, canvas: canvas as never, viewport }).promise;
  return new Uint8Array(await canvas.encode('png'));
}

export function indexConstructionDrawingText(entry: Entry) {
  const context = currentRecordContext();
  if (!context || context.domainTenantId !== entry.tenantId) throw new Error('Drawing index tenant mismatch.');
  const rows = index(true).entries;
  const at = rows.findIndex((row) => row.fileId === entry.fileId);
  if (at >= 0) rows[at] = entry; else rows.push(entry);
}
export function indexedConstructionDrawingFileIds(): Set<string> { return new Set(index().entries.map((row) => row.fileId)); }
export function constructionDocumentIndexEntry(fileId: string): Entry | undefined { return index().entries.find((row) => row.fileId === fileId); }

const STOP = new Set(['what', 'when', 'where', 'which', 'with', 'from', 'this', 'that', 'have', 'does', 'about', 'project', 'drawing', 'document', 'show', 'tell']);
export function retrieveConstructionDocumentText(actor: Actor, visibleDocs: readonly ConstructionDoc[], question: string) {
  if (!question.trim() || currentRecordContext()?.domainTenantId !== actor.tenantId) return [];
  const terms = [...new Set((question.toLowerCase().match(/[a-z0-9]{4,}/g) ?? []).filter((word) => !STOP.has(word)))].slice(0, 20);
  if (!terms.length) return [];
  const docs = new Map(visibleDocs.filter((doc) => doc.status === 'approved' && doc.fileId && doc.fileSha256 && doc.tenantId === actor.tenantId)
    .map((doc) => [doc.fileId!, doc]));
  return index().entries.filter((entry) => entry.tenantId === actor.tenantId && (actor.constructionProjectIds === undefined || actor.constructionProjectIds.includes(entry.projectId)) && docs.get(entry.fileId)?.id === entry.docId &&
      docs.get(entry.fileId)?.projectId === entry.projectId && docs.get(entry.fileId)?.fileSha256 === entry.sha256)
    .flatMap((entry) => entry.pages.map((page) => {
      const doc = docs.get(entry.fileId)!;
      const lower = page.text.toLowerCase();
      const metadata = `${doc.number} ${doc.title} ${doc.folder} ${doc.discipline}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (lower.includes(term) ? 2 : metadata.includes(term) ? 1 : 0), 0);
      return { docId: doc.id, projectId: entry.projectId, fileId: entry.fileId, number: doc.number, revision: doc.revision,
        title: doc.title, folder: doc.folder, method: page.method ?? 'text', page: page.page, text: page.text.slice(0, 1200), score };
    })).filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.number.localeCompare(b.number)).slice(0, 6);
}
