// Google Places API (New): Lead-Suche, Unternehmensprofil, Ranking und Heatmap-Raster.
// Benötigt GOOGLE_PLACES_API_KEY. PLACES_BASE_URL nur für Tests überschreiben.

const BASE = () => (process.env.PLACES_BASE_URL || 'https://places.googleapis.com/v1').replace(/\/$/, '');
export const hasPlacesKey = () => !!process.env.GOOGLE_PLACES_API_KEY;

const LIST_FIELDS = ['id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount', 'websiteUri',
  'nationalPhoneNumber', 'businessStatus', 'googleMapsUri', 'primaryType', 'primaryTypeDisplayName', 'photos', 'regularOpeningHours'];
const DETAIL_FIELDS = [...LIST_FIELDS, 'internationalPhoneNumber', 'reviews', 'types'];

async function call(path, { method = 'POST', body, fields }) {
  if (!hasPlacesKey()) throw new Error('GOOGLE_PLACES_API_KEY ist nicht gesetzt');
  const r = await fetch(BASE() + path, {
    method, signal: AbortSignal.timeout(20000),
    headers: { 'content-type': 'application/json', 'X-Goog-Api-Key': process.env.GOOGLE_PLACES_API_KEY, 'X-Goog-FieldMask': fields },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google Places: ${data.error?.message || r.status}`);
  return data;
}

// Einheitliches, schlankes Format für die App
export function slimPlace(p) {
  return {
    place_id: p.id, name: p.displayName?.text || '', address: p.formattedAddress || '',
    lat: p.location?.latitude ?? null, lng: p.location?.longitude ?? null,
    rating: p.rating ?? null, review_count: p.userRatingCount ?? 0, website: p.websiteUri || '',
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || '', status: p.businessStatus || '',
    maps_url: p.googleMapsUri || '', category: p.primaryTypeDisplayName?.text || p.primaryType || '',
    photos: p.photos?.length || 0, has_hours: !!p.regularOpeningHours,
  };
}

export function distanceKm(a, b) {
  const R = 6371; const rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat); const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function geocode(text) {
  const d = await call('/places:searchText', { body: { textQuery: text, languageCode: 'de', pageSize: 1 }, fields: 'places.location,places.formattedAddress' });
  const p = d.places?.[0];
  if (!p?.location) throw new Error(`Standort „${text}“ nicht gefunden`);
  return { lat: p.location.latitude, lng: p.location.longitude, label: p.formattedAddress };
}

export async function searchText({ query, lat, lng, radiusM = 5000, pages = 1 }) {
  const out = []; let pageToken;
  for (let i = 0; i < pages; i++) {
    const body = { textQuery: query, languageCode: 'de', regionCode: 'DE', pageSize: 20, pageToken };
    if (lat != null) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius: Math.min(radiusM, 50000) } };
    const d = await call('/places:searchText', { body, fields: LIST_FIELDS.map((f) => 'places.' + f).join(',') + ',nextPageToken' });
    out.push(...(d.places || []).map(slimPlace));
    pageToken = d.nextPageToken; if (!pageToken) break;
  }
  return out;
}

// Lead-Finder: Unternehmen zu einem Suchbegriff im Umkreis eines Ortes
export async function searchArea({ query, location, radiusKm = 5 }) {
  const center = await geocode(location);
  const found = await searchText({ query, lat: center.lat, lng: center.lng, radiusM: radiusKm * 1000, pages: 3 });
  const seen = new Set();
  const results = found.filter((p) => p.lat != null && !seen.has(p.place_id) && seen.add(p.place_id))
    .map((p) => ({ ...p, distance_km: Math.round(distanceKm(center, p) * 10) / 10 }))
    .filter((p) => p.distance_km <= radiusKm * 1.1);
  return { center, results };
}

export async function placeDetails(placeId) {
  const d = await call(`/places/${encodeURIComponent(placeId)}?languageCode=de`, { method: 'GET', fields: DETAIL_FIELDS.join(',') });
  const reviews = (d.reviews || []).map((r) => ({
    rating: r.rating, text: r.text?.text || r.originalText?.text || '', author: r.authorAttribution?.displayName || '',
    when: r.relativePublishTimeDescription || '', published: r.publishTime || '',
  }));
  return { ...slimPlace(d), reviews, opening_hours: d.regularOpeningHours?.weekdayDescriptions || [] };
}

export async function findBusiness(name, address = '') {
  const d = await call('/places:searchText', { body: { textQuery: `${name} ${address}`.trim(), languageCode: 'de', pageSize: 1 }, fields: 'places.id' });
  return d.places?.[0]?.id || null;
}

// Position eines Unternehmens für ein Suchwort, gesehen von einem Punkt aus (Näherung an „… in meiner Nähe“)
export async function rankAt({ keyword, lat, lng, placeId, radiusM = 2000 }) {
  const results = await searchText({ query: keyword, lat, lng, radiusM, pages: 1 });
  const idx = results.findIndex((p) => p.place_id === placeId);
  return { rank: idx >= 0 ? idx + 1 : null, results };
}

// Quadratisches Raster um einen Mittelpunkt; äußerste Punkte liegen auf dem Radius
export function gridPoints(lat, lng, size, radiusKm) {
  const pts = []; const half = (size - 1) / 2; const step = size > 1 ? radiusKm / half : 0;
  const dLat = step / 111.32; const dLng = step / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) pts.push({ row: r, col: c, lat: lat + (half - r) * dLat, lng: lng + (c - half) * dLng });
  return pts;
}

export async function heatmapScan({ keyword, lat, lng, placeId, size = 3, radiusKm = 3 }) {
  if (![3, 5, 7].includes(size)) throw new Error('Rastergröße muss 3, 5 oder 7 sein');
  const points = gridPoints(lat, lng, size, radiusKm);
  const spacingM = Math.max(500, (radiusKm * 1000) / Math.max(1, (size - 1) / 2));
  const out = [];
  for (const p of points) {
    const { rank, results } = await rankAt({ keyword, lat: p.lat, lng: p.lng, placeId, radiusM: spacingM });
    out.push({ ...p, rank, top: results.slice(0, 3).map((x) => x.name) });
  }
  const ranks = out.map((p) => p.rank ?? 21);
  const avg = Math.round((ranks.reduce((a, b) => a + b, 0) / ranks.length) * 10) / 10;
  // Anteil der Punkte in den Top 3 = Sichtbarkeit
  const score = Math.round((out.filter((p) => p.rank && p.rank <= 3).length / out.length) * 100);
  return { keyword, size, radius_km: radiusKm, center: { lat, lng }, points: out, avg_rank: avg, score, scanned_at: new Date().toISOString() };
}

// Wie lohnend ist der Interessent für eine Webagentur? 0–100, höher = mehr Bedarf = besserer Lead.
// `site` ist das Ergebnis der Schnellprüfung (quickSiteCheck), sofern vorhanden.
export function leadPotential(p, site = null) {
  let s = 0; const why = [];
  const add = (n, reason) => { s += n; why.push(reason); };
  if (!p.website) add(40, 'keine Website');
  else if (site) {
    if (!site.reachable) add(30, 'Website nicht erreichbar');
    else {
      if (!site.https) add(10, 'keine Verschlüsselung (https)');
      if (!site.viewport) add(15, 'nicht für Smartphones optimiert');
      if (site.builder) add(10, `Homepage-Baukasten (${site.cms.find((c) => c !== 'WordPress') || site.cms[0]})`);
      if (site.ms > 3000) add(5, `langsam (${(site.ms / 1000).toFixed(1).replace('.', ',')} s)`);
      if (!site.analytics) add(5, 'kein Tracking');
      if (!site.chat?.length) add(3, 'kein Chat/WhatsApp');
    }
  }
  if (p.rating == null) add(10, 'keine Bewertungen');
  else if (p.rating < 4.2) add(15, `nur ${String(p.rating).replace('.', ',')} Sterne`);
  if ((p.review_count || 0) < 20) add(15, `wenige Bewertungen (${p.review_count || 0})`);
  if ((p.photos || 0) < 5) add(10, 'kaum Fotos');
  if (!p.has_hours) add(7, 'keine Öffnungszeiten');
  if (!p.phone) add(10, 'keine Telefonnummer');
  const score = Math.min(100, s);
  return { score, level: score >= 60 ? 'hoch' : score >= 35 ? 'mittel' : 'niedrig', why, checked: !p.website || !!site };
}
