import type { ProjectLocation } from './types';

export const FIELD_SITE_RADIUS_METERS = 200;
export const FIELD_MAX_ACCURACY_METERS = 75;
export const FIELD_MAX_FIX_AGE_MS = 2 * 60 * 1000;
export const FIELD_MAX_OFFLINE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type Fix = { latitude: number; longitude: number; accuracyMeters: number; locationAtISO: string };
type Assessment = { ok: true; siteLocationId: string; distanceMeters: number; dateISO: string } | { ok: false; error: string };

function distanceMeters(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const radians = (value: number) => value * Math.PI / 180;
  const latitudeDelta = radians(b.latitude - a.latitude);
  const longitudeDelta = radians(b.longitude - a.longitude);
  const arc = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(arc), Math.sqrt(1 - arc));
}

/** A device-reported location check. It is not tamper-proof proof of physical presence. */
export function assessFieldCheckIn(fix: Fix, capturedISO: string, nowISO: string, locations: readonly ProjectLocation[]): Assessment {
  const captured = Date.parse(capturedISO), located = Date.parse(fix.locationAtISO), now = Date.parse(nowISO);
  if (![captured, located, now, fix.latitude, fix.longitude, fix.accuracyMeters].every(Number.isFinite)) return { ok: false, error: 'A valid device location and capture time are required.' };
  if (captured > now + FIELD_MAX_FIX_AGE_MS || now - captured > FIELD_MAX_OFFLINE_AGE_MS) return { ok: false, error: 'The check-in is outside the seven-day offline window.' };
  if (Math.abs(captured - located) > FIELD_MAX_FIX_AGE_MS) return { ok: false, error: 'Capture a fresh location fix when checking in.' };
  if (fix.accuracyMeters <= 0 || fix.accuracyMeters > FIELD_MAX_ACCURACY_METERS) return { ok: false, error: 'Location accuracy is too low. Move into open sky and retry.' };
  const sites = locations.filter((row) => row.kind === 'site' && Number.isFinite(row.latitude) && Number.isFinite(row.longitude)) as (ProjectLocation & { latitude: number; longitude: number })[];
  if (!sites.length) return { ok: false, error: 'This project needs site coordinates in Project Setup before location check-in.' };
  const nearest = sites.map((site) => ({ site, distance: distanceMeters(fix, site) })).sort((a, b) => a.distance - b.distance)[0];
  if (nearest.distance > FIELD_SITE_RADIUS_METERS) return { ok: false, error: 'Your reported location is outside the configured site radius.' };
  const dateISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(captured));
  return { ok: true, siteLocationId: nearest.site.id, distanceMeters: Math.round(nearest.distance), dateISO };
}
