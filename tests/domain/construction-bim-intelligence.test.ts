import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { createBcfZip, parseBcfZip } from '@/domain/construction/bcf';
import { detectModelFormat, compareModels } from '@/domain/construction/model-clashes';
import { evaluateConstructionForecasts, type ForecastSnapshot } from '@/domain/construction/forecast-evaluation';
import { parseIfcMesh, parseIfcModel } from '@/server/construction/ifc-model';
import { extractConstructionPdfText } from '@/server/construction/document-text';
import { retrieveConstructionDocumentText } from '@/server/construction/document-text';
import { runWithRecordContext } from '@/server/data/record-context';
import { createDemoWorkspaceState } from '@/server/data/demo-state';
import { actorForCompanyMember } from '@/lib/auth/company-policy';
import type { ConstructionDoc } from '@/domain/construction/types';
import { validCopilotSource } from '@/lib/ai/copilot-protocol';

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
    expect(parseBcfZip(zip)).toEqual([{ guid, title: 'Duct and beam overlap', description: 'Check level 4 coordination', status: 'Open',
      createdAtISO: '2026-10-31T10:00:00.000Z', componentIds: ['0sfBnoLAb0R9H9P$iaZWyE'], point: [1, 2, 3] }]);
  });

  it('extracts only actual PDF text layers with page numbers', async () => {
    const pdf = await PDFDocument.create(); const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf.addPage().drawText('Approved drainage detail for level four', { x: 40, y: 700, font, size: 12 });
    const pages = await extractConstructionPdfText(await pdf.save());
    expect(pages).toEqual([{ page: 1, text: 'Approved drainage detail for level four' }]);
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

  it('uses later completed projects to check the empirical error band', () => {
    const snapshots: ForecastSnapshot[] = Array.from({ length: 20 }, (_, index) => ({ id: String(index), tenantId: 'tenant-a', projectId: `p-${index}`, projectName: `Project ${index}`,
      recordedAtISO: '2026-01-01T10:00:00Z', predictedFinishISO: '2026-02-01', predictedCostMinor: 10000,
      baselineFinishISO: '2026-02-01', cpi: 1, spi: 1, recordedBy: 'pm' }));
    const outcomes = snapshots.map((row, index) => ({ projectId: row.projectId, completedAtISO: `2026-02-${String(index + 2).padStart(2, '0')}T12:00:00Z`, actualCostMinor: 10000 + index * 1000 }));
    expect(evaluateConstructionForecasts(snapshots.slice(0, 19), outcomes).validationReady).toBe(false);
    const evaluated = evaluateConstructionForecasts(snapshots, outcomes);
    expect(evaluated.validationReady).toBe(true);
    expect(evaluated.trainingCount).toBe(14);
    expect(evaluated.holdoutCount).toBe(6);
    expect(evaluated.holdoutFinishCoveragePct).toBe(0);
    expect(evaluated.calibrated).toBe(false);
    expect(evaluated.count).toBe(20);
  });
});
