/**
 * Construction is retained in the codebase and database for future reopening.
 * An explicit build flag is required to make its operational surface available.
 */
export function constructionArchived(): boolean {
  return process.env.NEXT_PUBLIC_ENABLE_CONSTRUCTION !== 'true';
}

export function archivedConstructionPath(pathname: string): boolean {
  return pathname === '/construction'
    || pathname.startsWith('/construction/')
    || pathname === '/api/construction'
    || pathname.startsWith('/api/construction/')
    || pathname === '/api/mobile/v1/construction'
    || pathname.startsWith('/api/mobile/v1/construction/');
}
