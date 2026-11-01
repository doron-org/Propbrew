const aiRoutes = new Set(['/api/copilot', '/api/estate/copilot', '/api/shortlet/copilot', '/api/construction/copilot']);
const fileId = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const facilityEvidence = new RegExp(`^/api/facility/evidence/${fileId}$`, 'i');
const constructionDrawing = new RegExp(`^/api/construction/drawings/${fileId}$`, 'i');
const constructionHandover = /^\/api\/construction\/handover\/chp-[0-9a-f-]{36}$/i;
const constructionEvidence = /^\/api\/construction\/evidence\/sync-[0-9a-f]{32}\/(?:[0-9]|1[0-9])$/i;
const constructionFieldPhoto = new RegExp(`^/api/construction/field-photos/${fileId}$`, 'i');

/** The native-auth proxy permits only company-aware API routes. The routes
 * themselves still perform session, company and record-level authorization. */
export function nativeApiRouteAllowed(pathname: string): boolean {
  return pathname.startsWith('/api/auth/')
    || pathname.startsWith('/api/mobile/v1/')
    || pathname === '/api/companies'
    || pathname === '/api/companies/select'
    || pathname === '/api/v1/health'
    || aiRoutes.has(pathname)
    || pathname === '/api/facility/evidence'
    || facilityEvidence.test(pathname)
    || pathname === '/api/construction/drawings'
    || pathname === '/api/construction/drawings/reindex'
    || pathname === '/api/construction/models'
    || pathname === '/api/construction/models/detect'
    || pathname === '/api/construction/models/bcf'
    || new RegExp(`^/api/construction/models/${fileId}$`, 'i').test(pathname)
    || new RegExp(`^/api/construction/models/${fileId}/mesh$`, 'i').test(pathname)
    || pathname === '/api/construction/models/revisions'
    || pathname === '/api/construction/transmittals'
    || pathname === '/api/construction/transmittals/acknowledge'
    || /^\/api\/construction\/transmittals\/tr-new-[1-9][0-9]{0,12}\/retry$/.test(pathname)
    || pathname === '/api/construction/reports/export'
    || pathname === '/api/webhooks/resend'
    || constructionDrawing.test(pathname)
    || constructionEvidence.test(pathname)
    || constructionFieldPhoto.test(pathname)
    || constructionHandover.test(pathname);
}
