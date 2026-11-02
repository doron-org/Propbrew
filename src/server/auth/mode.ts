/** Runtime-only switch. A client build flag never grants an identity. */
export function nativeAuthEnabled(): boolean { return process.env.PROPBREW_AUTH_MODE === 'company'; }

/** Railway terminates TLS before Next; trust configured origins, never ingress host headers. */
export function nativeRequestOriginAllowed(request: Request): boolean {
  const origin = request.headers.get('Origin');
  if (!origin || request.headers.get('Sec-Fetch-Site') === 'cross-site') return false;
  try {
    const canonical = new URL(process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').origin;
    const allowed = [canonical, ...(process.env.PROPBREW_AUTH_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean)];
    return allowed.includes(origin);
  } catch { return false; }
}

/** Public email receipt forms may omit Origin in embedded browsers. A matching
 * same-origin Referer and Fetch Metadata still bind the submission to our app. */
export function nativePublicFormOriginAllowed(request: Request): boolean {
  if (nativeRequestOriginAllowed(request)) return true;
  const site = request.headers.get('Sec-Fetch-Site');
  if (site && site !== 'same-origin') return false;
  const referer = request.headers.get('Referer');
  if (!referer) return false;
  try {
    const refererOrigin = new URL(referer).origin;
    const canonical = new URL(process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? '').origin;
    const allowed = [canonical, ...(process.env.PROPBREW_AUTH_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean)];
    return allowed.includes(refererOrigin);
  } catch { return false; }
}
