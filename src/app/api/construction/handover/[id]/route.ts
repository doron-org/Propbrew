import { canEnterWorkspace } from '@/config/workspaces';
import { handoverOmissions, HANDOVER_REQUIREMENTS } from '@/domain/construction/control';
import { assertCan, matchesScope } from '@/lib/authz';
import { constructionControl } from '@/server/construction-control';
import { constructionDrawingVisible, readConstructionDrawing } from '@/server/construction/drawings';
import { handoverZip } from '@/server/construction/handover-zip';
import { repos } from '@/server/data';
import { withDurableRead } from '@/server/data/durable-records';
import { getActor } from '@/server/session';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor();
    if (!actor.tenantId || !canEnterWorkspace(actor, 'construction')) return new Response(null, { status: 404 });
    const scope = assertCan(actor, 'reports_analytics', 'read');
    const packId = (await context.params).id;
    const data = await withDurableRead(async () => {
      const pack = constructionControl(actor.tenantId!).handoverPacks.find((row) => row.id === packId && row.status === 'approved' && matchesScope(row, scope));
      if (!pack) return null;
      const docs = repos.constructionDocs.list(actor, { limit: 5000 }).items;
      if (handoverOmissions(pack, docs).length) return null;
      const selected = pack.items.map((item) => ({ item, doc: docs.find((row) => row.id === item.docId && row.projectId === pack.projectId) }));
      if (selected.some((row) => !row.doc || !constructionDrawingVisible(actor, row.doc))) return null;
      if (selected.reduce((sum, row) => sum + (row.doc?.fileSizeBytes ?? 0), 0) > 49_000_000) throw new Error('Handover archive exceeds the download limit.');
      return { ref: pack.ref, title: pack.title, projectId: pack.projectId, approvalId: pack.approvalId,
        submittedBy: pack.submittedBy, submittedAtISO: pack.submittedAtISO, approvedBy: pack.approvedBy, approvedAtISO: pack.approvedAtISO,
        files: selected.map(({ item, doc }) => ({ requirement: item.requirement, number: item.number, revision: item.revision, sha256: item.fileSha256, fileId: doc!.fileId! })) };
    });
    if (!data) return new Response(null, { status: 404 });
    const files = await Promise.all(data.files.map(async (row) => ({ ...row, file: await readConstructionDrawing(row.fileId) })));
    const safeFilename = (row: typeof files[number]) => `${row.requirement}-${row.number}-rev-${row.revision}.pdf`.replace(/[^A-Za-z0-9_.-]/g, '_');
    const manifest = { ref: data.ref, title: data.title, projectId: data.projectId, approvedAtISO: data.approvedAtISO,
      signOff: { submittedBy: data.submittedBy, submittedAtISO: data.submittedAtISO, approvedBy: data.approvedBy, approvedAtISO: data.approvedAtISO, fieldApprovalId: data.approvalId },
      documents: files.map((row) => ({ requirement: HANDOVER_REQUIREMENTS.find((entry) => entry.key === row.requirement)?.label, number: row.number, revision: row.revision, sha256: row.sha256, filename: safeFilename(row) })) };
    const entries = [{ name: 'manifest.json', bytes: new TextEncoder().encode(JSON.stringify(manifest, null, 2)) },
      ...files.map((row) => ({ name: safeFilename(row), bytes: row.file.bytes }))];
    const archive = handoverZip(entries);
    return new Response(archive as BodyInit, { headers: { 'Content-Type': 'application/zip', 'Content-Length': String(archive.length),
      'Content-Disposition': `attachment; filename="${data.ref}.zip"`, 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'none'" } });
  } catch (error) {
    const tooLarge = error instanceof Error && error.message === 'Handover archive exceeds the download limit.';
    return Response.json({ error: tooLarge ? 'This handover pack exceeds the 50 MB download limit.' : 'Handover pack unavailable.' }, { status: tooLarge ? 413 : 503, headers: { 'Cache-Control': 'private, no-store' } });
  }
}
