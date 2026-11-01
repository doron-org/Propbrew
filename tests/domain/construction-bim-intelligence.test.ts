import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { unzipSync, zipSync } from 'fflate';
import { createBcfZip, parseBcfZip } from '@/domain/construction/bcf';
import { detectModelFormat, compareModels } from '@/domain/construction/model-clashes';
import { evaluateConstructionForecasts, type ForecastSnapshot } from '@/domain/construction/forecast-evaluation';
import { parseIfcMesh, parseIfcModel } from '@/server/construction/ifc-model';
import { extractConstructionPdfText, extractConstructionPdfForIndex } from '@/server/construction/document-text';
import { retrieveConstructionDocumentText } from '@/server/construction/document-text';
import { runWithRecordContext } from '@/server/data/record-context';
import { createDemoWorkspaceState } from '@/server/data/demo-state';
import { actorForCompanyMember } from '@/lib/auth/company-policy';
import type { ConstructionDoc } from '@/domain/construction/types';
import { validCopilotSource } from '@/lib/ai/copilot-protocol';
import { validateDocumentFindings } from '@/server/construction/document-answer-evaluation';

describe('native construction BIM exchange and forecast evidence', () => {
  it('parses a real IFC file into metre-space elements retaining IFC GlobalIds', async () => {
    // That Open web-ifc public example model, used only as an interoperability fixture.
    const file = new Uint8Array(readFileSync(fileURLToPath(new URL('../fixtures/construction/web-ifc-example.ifc', import.meta.url))));
    expect(detectModelFormat(file, 'building.ifc')).toBe('ifc');
    const elements = await parseIfcModel(file);
    expect(elements.length).toBeGreaterThan(50);
    expect(elements.some((row) => /^[0-9A-Za-z_$]{22}$/.test(row.id))).toBe(true);
    expect(elements.every((row) => row.min.every(Number.isFinite) && row.max.every(Number.isFinite))).toBe(true);
    expect(compareModels(elements.slice(0, 1), elements.slice(1, 2))).toBeDefined();
    const meshes = await parseIfcMesh(file);
    expect(meshes.length).toBeGreaterThan(50);
    expect(meshes.some((row) => /^[0-9A-Za-z_$]{22}$/.test(row.id) && row.positions.length >= 9)).toBe(true);
    expect(meshes.every((row) => row.positions.length === row.triangleCount * 9)).toBe(true);
  });

  it('round trips BCF 3.0 topics with IFC component references', () => {
    const guid = '12345678-1234-4234-8234-123456789abc';
    const zip = createBcfZip('Lagos tower', guid, [{ guid, title: 'Duct and beam overlap', description: 'Check level 4 coordination',
      status: 'Open', createdAtISO: '2026-10-31T10:00:00.000Z', componentIds: ['0sfBnoLAb0R9H9P$iaZWyE'], point: [1, 2, 3] }]);
    expect(parseBcfZip(zip)).toMatchObject([{ guid, title: 'Duct and beam overlap', description: 'Check level 4 coordination', status: 'Open',
      createdAtISO: '2026-10-31T10:00:00.000Z', componentIds: ['0sfBnoLAb0R9H9P$iaZWyE'], point: [1, 2, 3],
      viewpoints: [{ guid, camera: { kind: 'Perspective', position: [1, 2, 3] } }] }]);
  });

  it('keeps multiple complete viewpoints, snapshot bytes and dated discussion across two BCF exports', () => {
    const guid = '12345678-1234-4234-8234-123456789abc', first = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', second = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9z7xQAAAAASUVORK5CYII=';
    const camera = (id: string, x: number) => `<VisualizationInfo Guid="${id}"><Components><Selection><Component IfcGuid="0sfBnoLAb0R9H9P$iaZWyE"/></Selection><Visibility DefaultVisibility="true"><Exceptions><Component IfcGuid="0sfBnoLAb0R9H9P$iaZWyE"/></Exceptions></Visibility></Components><PerspectiveCamera><CameraViewPoint><X>${x}</X><Y>2</Y><Z>3</Z></CameraViewPoint><CameraDirection><X>0</X><Y>0</Y><Z>-1</Z></CameraDirection><CameraUpVector><X>0</X><Y>1</Y><Z>0</Z></CameraUpVector><FieldOfView>60</FieldOfView><AspectRatio>1.6</AspectRatio></PerspectiveCamera><ClippingPlanes><ClippingPlane><Location><X>0</X><Y>0</Y><Z>0</Z></Location><Direction><X>0</X><Y>0</Y><Z>1</Z></Direction></ClippingPlane></ClippingPlanes></VisualizationInfo>`;
    const topic = { guid, title: 'Review duct route', description: 'MEP coordination', status: 'InProgress', topicType: 'Clash',
      createdAtISO: '2026-10-31T10:00:00.000Z', createdAuthor: 'Consultant A', modifiedAtISO: '2026-10-31T11:00:00.000Z', modifiedAuthor: 'Consultant B',
      componentIds: ['0sfBnoLAb0R9H9P$iaZWyE'], comments: [
        { guid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', dateISO: '2026-10-31T10:30:00.000Z', author: 'Consultant A', text: 'Please reroute the duct.', viewpointGuid: first },
        { guid: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', dateISO: '2026-10-31T11:00:00.000Z', author: 'Consultant B', text: 'Revised viewpoint attached.', viewpointGuid: second },
      ], viewpoints: [
        { guid: first, fileName: 'first.bcfv', index: 0, xml: camera(first, 1), componentIds: ['0sfBnoLAb0R9H9P$iaZWyE'], snapshot: { fileName: 'first.png', mediaType: 'image/png' as const, base64: png } },
        { guid: second, fileName: 'second.bcfv', index: 1, xml: camera(second, 4), componentIds: ['0sfBnoLAb0R9H9P$iaZWyE'] },
      ] };
    const one = parseBcfZip(createBcfZip('Lagos tower', guid, [topic]));
    expect(one[0].comments).toEqual(topic.comments);
    expect(one[0].viewpoints?.map((view) => view.xml)).toEqual(topic.viewpoints.map((view) => view.xml));
    expect(one[0].viewpoints?.[0].snapshot?.base64).toBe(png);
    expect(one[0].viewpoints?.[0].camera?.position).toEqual([1, 2, 3]);
    expect(one[0].viewpoints?.[1].camera?.position).toEqual([4, 2, 3]);
    expect(parseBcfZip(createBcfZip('Lagos tower', guid, one))[0]).toEqual(one[0]);
    const missing = unzipSync(createBcfZip('Lagos tower', guid, [topic]));
    delete missing[`${guid}/first.png`];
    expect(() => parseBcfZip(zipSync(missing))).toThrow(/snapshot is missing/);
  });

  it('preserves a snapshot-only BCF viewpoint and rejects images beyond the standard display limit', () => {
    const guid = '12345678-1234-4234-8234-123456789abc', viewGuid = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9z7xQAAAAASUVORK5CYII=';
    const topic = { guid, title: 'Check service opening', description: '', status: 'Open', createdAtISO: '2026-10-31T10:00:00.000Z', componentIds: [],
      viewpoints: [{ guid: viewGuid, componentIds: [], snapshot: { fileName: 'site.png', mediaType: 'image/png' as const, base64: png } }] };
    expect(parseBcfZip(createBcfZip('Lagos tower', guid, [topic]))[0].viewpoints?.[0]).toMatchObject({ guid: viewGuid, snapshot: { base64: png } });
    const oversized = Buffer.from(png, 'base64'); oversized.writeUInt32BE(1501, 16);
    expect(() => createBcfZip('Lagos tower', guid, [{ ...topic, viewpoints: [{ ...topic.viewpoints[0], snapshot: { ...topic.viewpoints[0].snapshot, base64: oversized.toString('base64') } }] }]))
      .toThrow(/snapshot is invalid/);
  });

  it('extracts only actual PDF text layers with page numbers', async () => {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Approved drainage detail for level four', { x: 40, y: 700, font, size: 12 });
    const pages = await extractConstructionPdfText(await pdf.save());
    expect(pages).toEqual([{ page: 1, text: 'Approved drainage detail for level four', method: 'text' }]);
  });

  it('renders scanned pages for OCR in bounded passes and preserves page citations', async () => {
    const pdf = await PDFDocument.create();
    const { createCanvas } = await import('@napi-rs/canvas');
    const canvas = createCanvas(500, 180); const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 500, 180);
    ctx.fillStyle = '#000'; ctx.font = '30px sans-serif'; ctx.fillText('SPEC 07-12 WATERPROOFING', 15, 90);
    const png = await pdf.embedPng(await canvas.encode('png'));
    for (let index = 0; index < 3; index++) pdf.addPage([500, 180]).drawImage(png, { x: 0, y: 0, width: 500, height: 180 });
    const bytes = await pdf.save(); const seen: number[] = [];
    const first = await extractConstructionPdfForIndex(bytes, { maxOcrPages: 2, ocrPage: async (image, page) => {
      expect(image.subarray(0, 8)).toEqual(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]));
      seen.push(page); return 'SPEC 07-12 WATERPROOFING - revised membrane detail';
    } });
    expect(seen).toEqual([1, 2]); expect(first.pendingPages).toEqual([3]);
    expect(first.pages.map((row) => [row.page, row.method])).toEqual([[1, 'ocr'], [2, 'ocr']]);
    const second = await extractConstructionPdfForIndex(bytes, { existing: { tenantId: 't', projectId: 'p', docId: 'd', fileId: 'f', sha256: 's', pages: first.pages, pendingPages: first.pendingPages, extractedAtISO: '' },
      maxOcrPages: 2, ocrPage: async () => 'SPEC 07-12 WATERPROOFING - revised membrane detail' });
    expect(second.pendingPages).toEqual([]); expect(second.pages.map((row) => row.page)).toEqual([1, 2, 3]);
  });

  it('does not treat a selectable title block as a fully searchable scanned plan', async () => {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    const page = pdf.addPage(); page.drawText('SITE PLAN A', { x: 30, y: 700, font, size: 12 });
    const bytes = await pdf.save();
    const first = await extractConstructionPdfForIndex(bytes);
    expect(first.pages).toEqual([{ page: 1, text: 'SITE PLAN A', method: 'text' }]);
    expect(first.pendingPages).toEqual([1]);
    const second = await extractConstructionPdfForIndex(bytes, { existing: { tenantId: 't', projectId: 'p', docId: 'd', fileId: 'f', sha256: 's', pages: first.pages, pendingPages: first.pendingPages, extractedAtISO: '' },
      maxOcrPages: 1, ocrPage: async () => 'SITE PLAN A drainage riser at grid B7' });
    expect(second.pendingPages).toEqual([]);
    expect(second.pages[0]).toMatchObject({ page: 1, method: 'ocr', text: 'SITE PLAN A drainage riser at grid B7' });
  });

  it('retrieves PDF pages only when tenant, project, document and file hash match an authorised revision', () => {
    const company = '46a4660b-90d2-478b-89b3-d516779bded2';
    const actor = actorForCompanyMember({ membershipId: 'm1', userId: 'u1', companyId: company, companyRole: 'member', status: 'active', companyStatus: 'active',
      modules: { construction: 'manage' }, operationalProfileId: 'project-manager', estateIds: [], allEstates: false,
      constructionProjectIds: ['cp-cedar'], allConstructionProjects: false }, 'u1')!;
    const doc = (id: string, projectId: string, tenantId = company): ConstructionDoc => ({ id, tenantId: tenantId as ConstructionDoc['tenantId'], projectId, number: id, title: 'Drainage', discipline: 'MEP',
      revision: 'A', status: 'approved', effectiveISO: '2026-10-01', folder: 'Drawings', fileId: '11111111-1111-4111-8111-111111111111', fileSha256: 'a'.repeat(64) });
    const state = createDemoWorkspaceState(company);
    state.auxiliary.constructionDocumentText = { entries: [{ tenantId: company, projectId: 'cp-cedar', docId: 'doc-1', fileId: '11111111-1111-4111-8111-111111111111',
      sha256: 'a'.repeat(64), pages: [{ page: 2, text: 'Drainage pipe detail at the east wing' }], extractedAtISO: '2026-10-01T10:00:00Z' }] };
    const search = (docs: ConstructionDoc[]) => runWithRecordContext({ state, domainTenantId: company, mode: 'read' }, () => retrieveConstructionDocumentText(actor, docs, 'Which drainage detail?'));
    expect(search([doc('doc-1', 'cp-cedar')])).toHaveLength(1);
    expect(search([doc('doc-1', 'cp-marina')])).toHaveLength(0);
    expect(search([doc('doc-1', 'cp-cedar', 'other-company')])).toHaveLength(0);
    expect(search([{ ...doc('doc-1', 'cp-cedar'), fileSha256: 'b'.repeat(64) }])).toHaveLength(0);
    expect(validCopilotSource('construction', { id: 'page', label: 'PDF page 2', href: '/api/construction/drawings/11111111-1111-4111-8111-111111111111?view=1#page=2' })).toBe(true);
    expect(validCopilotSource('estate', { id: 'page', label: 'PDF page 2', href: '/api/construction/drawings/11111111-1111-4111-8111-111111111111?view=1#page=2' })).toBe(false);
  });

  it('downgrades a claimed supported answer when its exact approved page was not cited', () => {
    const label = 'LAG-SPEC-104 · Waterproofing rev B · PDF page 3';
    const pages = [{ sourceId: 'construction-document-file-3', label }];
    const finding = [{ claim: 'Membrane thickness is 2 mm', sourceId: pages[0].sourceId, verdict: 'supported' as const }];
    expect(validateDocumentFindings(`The membrane is 2 mm thick (${label}).`, finding, pages)[0].verdict).toBe('supported');
    expect(validateDocumentFindings('The membrane is 2 mm thick.', finding, pages)[0].verdict).toBe('uncited');
    expect(validateDocumentFindings('The membrane is 2 mm thick.', finding, [])[0].verdict).toBe('uncited');
  });

  it('uses later completed projects to check the empirical error band', () => {
    const snapshots: ForecastSnapshot[] = Array.from({ length: 20 }, (_, index) => ({ id: String(index), tenantId: 'tenant-a', projectId: `p-${index}`, projectName: `Project ${index}`,
      recordedAtISO: '2026-01-01T10:00:00Z', predictedFinishISO: '2026-02-01', predictedCostMinor: 10000,
      baselineFinishISO: '2026-02-01', cpi: 1, spi: 1, recordedBy: 'pm' }));
    const outcomes = snapshots.map((row, index) => ({ tenantId: row.tenantId, projectId: row.projectId, completedAtISO: `2026-02-${String(index + 2).padStart(2, '0')}T12:00:00Z`, actualCostMinor: 10000 + index * 1000, projectType: 'residential' as const, region: 'Lagos, Nigeria' }));
    expect(evaluateConstructionForecasts(snapshots.slice(0, 19), outcomes).validationReady).toBe(false);
    const evaluated = evaluateConstructionForecasts(snapshots, outcomes);
    expect(evaluated.validationReady).toBe(true);
    expect(evaluated.trainingCount).toBe(14);
    expect(evaluated.holdoutCount).toBe(6);
    expect(evaluated.holdoutFinishCoveragePct).toBe(0);
    expect(evaluated.calibrated).toBe(false);
    expect(evaluated.count).toBe(20);
  });

  it('withholds cohort validation below 20 and raises a review signal when recent errors worsen', () => {
    const snapshots: ForecastSnapshot[] = Array.from({ length: 20 }, (_, index) => ({
      id: `forecast-${index}`, tenantId: 'tenant-a', projectId: `project-${index}`, projectName: `Project ${index}`,
      recordedAtISO: '2026-01-01T10:00:00Z', predictedFinishISO: new Date(Date.UTC(2026, 5, 1 + index - (index < 10 ? 1 : 10))).toISOString().slice(0, 10),
      predictedCostMinor: index < 10 ? 10000 : 7000, baselineFinishISO: '2026-06-01', cpi: 1, spi: 1, recordedBy: 'pm',
    }));
    const outcomes = snapshots.map((row, index) => ({
      tenantId: row.tenantId, projectId: row.projectId,
      completedAtISO: new Date(Date.UTC(2026, 5, 1 + index)).toISOString(),
      actualCostMinor: 10000, projectType: 'residential' as const,
      region: index < 19 ? 'Lagos, Nigeria' : 'Abuja, Nigeria',
    }));
    const result = evaluateConstructionForecasts(snapshots, outcomes);
    expect(result.count).toBe(20);
    expect(result.drift).toBe('review_trigger');
    expect(result.cohorts.find((row) => row.dimension === 'project_type' && row.label === 'residential')).toMatchObject({ count: 20, validationReady: true, drift: 'review_trigger' });
    expect(result.cohorts.find((row) => row.dimension === 'region' && row.label === 'Lagos, Nigeria')).toMatchObject({ count: 19, validationReady: false, drift: 'insufficient_history' });
  });

  it('never matches a completed project to another company’s forecast with the same project ID', () => {
    const snapshot: ForecastSnapshot = { id: 'other-company', tenantId: 'tenant-b', projectId: 'shared-id',
      projectName: 'Other project', recordedAtISO: '2026-01-01T10:00:00Z', predictedFinishISO: '2026-02-01',
      predictedCostMinor: 10000, baselineFinishISO: '2026-02-01', cpi: 1, spi: 1, recordedBy: 'pm' };
    const outcome = { tenantId: 'tenant-a', projectId: 'shared-id', completedAtISO: '2026-03-01T12:00:00Z',
      actualCostMinor: 15000, projectType: 'residential' as const, region: 'Lagos, Nigeria' };
    expect(evaluateConstructionForecasts([snapshot], [outcome]).count).toBe(0);
  });
});
