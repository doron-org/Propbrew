/**
 * Synthetic scanned controlled-drawing factory for the OCR sign-off harness.
 *
 * Draws construction document pages with @napi-rs/canvas (known ground truth),
 * then embeds them as raster-only pages in a PDF via pdf-lib — no text layer,
 * so the production extractor is forced down its OCR path.
 *
 * Every string rendered on a page is exported as ground truth so the harness
 * can score OCR fidelity and verify AI claims deterministically.
 */
import { createCanvas, type SKRSContext2D } from '@napi-rs/canvas';
import { PDFDocument } from 'pdf-lib';

export interface GroundTruthPage {
  page: number;
  /** Strings that MUST be transcribed for OCR to be considered faithful. */
  mustContain: string[];
  /** All visible text lines, in drawing order. */
  lines: string[];
}

export interface SyntheticDoc {
  number: string;
  title: string;
  revision: string;
  folder: string;
  discipline: string;
  pages: GroundTruthPage[];
  pngs: Buffer[]; // 1:1 with pages — the exact "cited page image" for review
  pdf: Uint8Array;
}

const W = 1754; // A3 landscape @ ~150 dpi
const H = 1240;

function basePage(ctx: SKRSContext2D) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 3;
  ctx.strokeRect(30, 30, W - 60, H - 60);
}

function titleBlock(ctx: SKRSContext2D, rows: [string, string][]) {
  const bx = W - 560, by = H - 420, bw = 520, rowH = 52;
  ctx.lineWidth = 2;
  ctx.strokeRect(bx, by, bw, rowH * rows.length);
  ctx.font = '26px Arial';
  ctx.fillStyle = '#000';
  rows.forEach(([k, v], i) => {
    const y = by + rowH * i;
    ctx.strokeRect(bx, y, bw, rowH);
    ctx.fillText(k, bx + 12, y + 34);
    ctx.fillText(v, bx + 190, y + 34);
  });
}

function speckle(ctx: SKRSContext2D, seed: number) {
  // Light scan noise — deterministic, keeps every character legible.
  let s = seed;
  const rand = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  ctx.fillStyle = 'rgba(0,0,0,0.05)';
  for (let i = 0; i < 900; i++) ctx.fillRect(rand() * W, rand() * H, 2, 2);
}

function textLines(ctx: SKRSContext2D, lines: string[], x: number, y0: number, gap = 46, font = '28px Arial') {
  ctx.font = font;
  ctx.fillStyle = '#000000';
  lines.forEach((line, i) => ctx.fillText(line, x, y0 + i * gap));
}

/* ---------------------------------- doc 1 --------------------------------- */

async function drawGroundFloorPlan(): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  basePage(ctx);
  ctx.font = 'bold 40px Arial';
  ctx.fillStyle = '#000';
  ctx.fillText('GROUND FLOOR PLAN — BLOCK A', 70, 100);
  ctx.font = '26px Arial';
  ctx.fillText('SCALE 1:100    STATUS: APPROVED FOR CONSTRUCTION', 70, 145);

  // Grid lines
  ctx.lineWidth = 1.5;
  const cols = [250, 700, 1150];
  const rowsY = [320, 650, 950];
  ctx.font = '24px Arial';
  cols.forEach((x, i) => {
    ctx.beginPath(); ctx.moveTo(x, 250); ctx.lineTo(x, 1000); ctx.stroke();
    ctx.beginPath(); ctx.arc(x, 230, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText(String(i + 1), x - 8, 238);
  });
  rowsY.forEach((y, i) => {
    ctx.beginPath(); ctx.moveTo(200, y); ctx.lineTo(1250, y); ctx.stroke();
    ctx.beginPath(); ctx.arc(170, y, 22, 0, Math.PI * 2); ctx.stroke();
    ctx.fillText(String.fromCharCode(65 + i), 163, y + 8);
  });

  // Rooms
  ctx.lineWidth = 3;
  ctx.strokeRect(250, 320, 450, 330);
  ctx.strokeRect(700, 320, 450, 330);
  ctx.strokeRect(250, 650, 450, 300);
  ctx.font = '28px Arial';
  ctx.fillText('LIVING ROOM', 330, 460);
  ctx.fillText('4200 x 3600', 340, 500);
  ctx.fillText('KITCHEN', 820, 460);
  ctx.fillText('3000 x 3300', 810, 500);
  ctx.fillText('BEDROOM 1', 330, 790);
  ctx.fillText('3600 x 3300', 340, 830);
  ctx.fillText('WALLS: 230mm SANDCRETE BLOCK', 700, 800);
  ctx.fillText('DOOR D1 900x2100', 700, 850);
  ctx.fillText('DOOR D2 800x2100', 700, 900);
  ctx.fillText('GLA 118.5 m2', 700, 950);

  titleBlock(ctx, [
    ['PROJECT', 'DELIVERY VALIDATION PILOT'],
    ['DRAWING', 'QA-ARC-201'],
    ['REVISION', 'C'],
    ['DATE', '2026-10-15'],
    ['TITLE', 'GROUND FLOOR PLAN'],
    ['DISCIPLINE', 'ARCHITECTURAL'],
  ]);
  speckle(ctx, 7);
  return canvas.encode('png'); // encode() resolves to a Buffer
}

/* ---------------------------------- doc 2 --------------------------------- */

const SPEC_PAGE1 = [
  'SPECIFICATION SECTION 07 12 00',
  'WATERPROOFING',
  '',
  'Clause 7.12.1: Membrane shall be 2 mm',
  'torch-applied bituminous sheet.',
  'Clause 7.12.2: Lap joints minimum 100 mm,',
  'fully sealed with torch.',
  'Clause 7.12.3: Primer coverage 0.3 L/m2',
  'on prepared concrete substrate.',
  'Clause 7.12.4: Protection board 3 mm',
  'before backfilling.',
];
const SPEC_PAGE2 = [
  'SPECIFICATION SECTION 07 13 00',
  'WATERPROOFING TESTING',
  '',
  'Clause 7.13.1: Flood test for 72 hours',
  'before screed application.',
  'Clause 7.13.2: Maximum deflection L/500',
  'under service load.',
  'Clause 7.13.3: Test records signed by',
  'the consultant engineer.',
];

async function drawSpecPage(page: 1 | 2): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  basePage(ctx);
  const lines = page === 1 ? SPEC_PAGE1 : SPEC_PAGE2;
  textLines(ctx, lines, 90, 130, 52);
  titleBlock(ctx, [
    ['PROJECT', 'DELIVERY VALIDATION PILOT'],
    ['DRAWING', 'LAG-SPEC-104'],
    ['REVISION', 'B'],
    ['DATE', '2026-09-28'],
    ['TITLE', `WATERPROOFING SPEC ${page}/2`],
    ['DISCIPLINE', 'SPECIFICATION'],
  ]);
  speckle(ctx, 13 + page);
  return canvas.encode('png'); // encode() resolves to a Buffer
}

/* ---------------------------------- doc 3 --------------------------------- */

async function drawFoundationLayout(): Promise<Buffer> {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  basePage(ctx);
  ctx.font = 'bold 40px Arial';
  ctx.fillStyle = '#000';
  ctx.fillText('FOUNDATION LAYOUT — BLOCK A', 70, 100);

  ctx.lineWidth = 3;
  ctx.strokeRect(250, 250, 500, 500);
  ctx.strokeRect(850, 250, 500, 500);
  ctx.font = '28px Arial';
  ctx.fillText('FOOTING F1', 350, 480);
  ctx.fillText('1800 x 1800 x 450 DEEP', 300, 525);
  ctx.fillText('FOOTING F2', 950, 480);
  ctx.fillText('1500 x 1500 x 400 DEEP', 900, 525);
  textLines(ctx, [
    'CONCRETE GRADE C30/37',
    'REINFORCEMENT: Y16 @ 200 c/c',
    'BOTH WAYS BOTTOM (F1)',
    'BLINDING 75 mm C12/15',
    'ALLOWABLE BEARING 150 kN/m2',
  ], 250, 830, 48);

  titleBlock(ctx, [
    ['PROJECT', 'DELIVERY VALIDATION PILOT'],
    ['DRAWING', 'QA-STR-110'],
    ['REVISION', 'A'],
    ['DATE', '2026-10-02'],
    ['TITLE', 'FOUNDATION LAYOUT'],
    ['DISCIPLINE', 'STRUCTURAL'],
  ]);
  speckle(ctx, 29);
  return canvas.encode('png'); // encode() resolves to a Buffer
}

/* -------------------------------- assembly -------------------------------- */

async function toPdf(pngs: Buffer[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const png of pngs) {
    const image = await doc.embedPng(png);
    const page = doc.addPage([1191, 842]); // A3 landscape, points
    page.drawImage(image, { x: 0, y: 0, width: 1191, height: 842 });
  }
  return doc.save({ useObjectStreams: false });
}

export async function buildSyntheticDocs(): Promise<SyntheticDoc[]> {
  const plan = await drawGroundFloorPlan();
  const spec1 = await drawSpecPage(1);
  const spec2 = await drawSpecPage(2);
  const found = await drawFoundationLayout();
  return [
    {
      number: 'QA-ARC-201', title: 'Ground Floor Plan', revision: 'C', folder: 'Architectural', discipline: 'Architectural',
      pages: [{
        page: 1,
        mustContain: ['QA-ARC-201', '4200 x 3600', '3000 x 3300', '3600 x 3300', '230mm SANDCRETE', '900x2100', '118.5'],
        lines: ['GROUND FLOOR PLAN — BLOCK A', 'LIVING ROOM 4200 x 3600', 'KITCHEN 3000 x 3300', 'BEDROOM 1 3600 x 3300', 'WALLS: 230mm SANDCRETE BLOCK', 'DOOR D1 900x2100', 'DOOR D2 800x2100', 'GLA 118.5 m2', 'DRAWING QA-ARC-201', 'REVISION C'],
      }],
      pngs: [plan], pdf: await toPdf([plan]),
    },
    {
      number: 'LAG-SPEC-104', title: 'Waterproofing Specification', revision: 'B', folder: 'Specifications', discipline: 'Specification',
      pages: [
        { page: 1, mustContain: ['07 12 00', '7.12.1', '2 mm', '7.12.2', '100 mm', '7.12.3', '0.3 L/m2'], lines: SPEC_PAGE1 },
        { page: 2, mustContain: ['07 13 00', '7.13.1', '72 hours', '7.13.2', 'L/500', 'consultant engineer'], lines: SPEC_PAGE2 },
      ],
      pngs: [spec1, spec2], pdf: await toPdf([spec1, spec2]),
    },
    {
      number: 'QA-STR-110', title: 'Foundation Layout', revision: 'A', folder: 'Structural', discipline: 'Structural',
      pages: [{
        page: 1,
        mustContain: ['QA-STR-110', 'C30/37', 'Y16 @ 200', '1800 x 1800 x 450', '75 mm', '150 kN/m2'],
        lines: ['FOUNDATION LAYOUT — BLOCK A', 'FOOTING F1 1800 x 1800 x 450 DEEP', 'FOOTING F2 1500 x 1500 x 400 DEEP', 'CONCRETE GRADE C30/37', 'REINFORCEMENT: Y16 @ 200 c/c BOTH WAYS BOTTOM (F1)', 'BLINDING 75 mm C12/15', 'ALLOWABLE BEARING 150 kN/m2', 'DRAWING QA-STR-110', 'REVISION A'],
      }],
      pngs: [found], pdf: await toPdf([found]),
    },
  ];
}
