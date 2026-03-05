/**
 * Geolocation Service
 * Detects user country via GPS + Nominatim reverse geocode.
 * Cached 24h in localStorage. Privacy: coords are only sent to OSM Nominatim.
 * Never stored in any backend.
 */

export interface GeoContext {
  country: string;       // "Lebanon"
  countryCode: string;   // "LB"
  region: string;        // "MENA" | "Europe" | "Asia" | "Americas" | "Africa" | "Global"
  lat: number;
  lng: number;
}

const CACHE_KEY = 'pos-geo';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// Map ISO country codes → our source region labels
const CODE_TO_REGION: Record<string, string> = {
  // MENA
  LB:'MENA', IL:'MENA', PS:'MENA', JO:'MENA', EG:'MENA', IQ:'MENA',
  SY:'MENA', YE:'MENA', IR:'MENA', SA:'MENA', QA:'MENA', AE:'MENA',
  KW:'MENA', BH:'MENA', OM:'MENA', LY:'MENA', TN:'MENA', DZ:'MENA', MA:'MENA',
  // Europe
  UA:'Europe', RU:'Europe', BY:'Europe', GB:'Europe', FR:'Europe',
  DE:'Europe', IT:'Europe', ES:'Europe', PL:'Europe', NL:'Europe',
  GR:'Europe', PT:'Europe', SE:'Europe', NO:'Europe', DK:'Europe',
  FI:'Europe', CH:'Europe', AT:'Europe', BE:'Europe', TR:'Europe',
  // Asia
  CN:'Asia', TW:'Asia', HK:'Asia', JP:'Asia', KR:'Asia', KP:'Asia',
  IN:'Asia', PK:'Asia', BD:'Asia', AF:'Asia', MM:'Asia', TH:'Asia',
  VN:'Asia', ID:'Asia', PH:'Asia', MY:'Asia', SG:'Asia', MN:'Asia',
  // Americas
  US:'Americas', CA:'Americas', MX:'Americas', BR:'Americas', AR:'Americas',
  CO:'Americas', CL:'Americas', PE:'Americas', VE:'Americas', CU:'Americas',
  // Africa
  NG:'Africa', ET:'Africa', SO:'Africa', SD:'Africa', SS:'Africa',
  ML:'Africa', BF:'Africa', NE:'Africa', CD:'Africa', ZA:'Africa',
  KE:'Africa', TZ:'Africa', UG:'Africa', GH:'Africa', MZ:'Africa',
};

export async function detectUserLocation(): Promise<GeoContext | null> {
  // Check cache
  try {
    const cached = localStorage.getItem(CACHE_KEY);
    if (cached) {
      const { data, ts } = JSON.parse(cached) as { data: GeoContext; ts: number };
      if (Date.now() - ts < CACHE_TTL) return data;
    }
  } catch {}

  if (!navigator.geolocation) return null;

  try {
    const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        timeout: 8000,
        enableHighAccuracy: false,
        maximumAge: CACHE_TTL,
      })
    );

    const { latitude: lat, longitude: lng } = pos.coords;

    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&format=json&accept-language=en`,
      { headers: { 'User-Agent': 'PerspectiveOS/1.0 (open-source news literacy tool)' } }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const country     = data.address?.country ?? 'Unknown';
    const countryCode = (data.address?.country_code ?? '').toUpperCase();
    const region      = CODE_TO_REGION[countryCode] ?? 'Global';

    const geo: GeoContext = { country, countryCode, region, lat, lng };
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ data: geo, ts: Date.now() }));
    } catch {}

    return geo;
  } catch (err) {
    console.warn('[Geo] Location detection failed:', err);
    return null;
  }
}

export function clearGeoCache(): void {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
}

/** Map our source regions to GDELT sourcelang/sourcecountry filters */
export function regionToGdeltFilter(region: string): string {
  const filters: Record<string, string> = {
    MENA:     'sourcelang:arabic OR sourcelang:hebrew OR (sourcecountry:Lebanon OR sourcecountry:Israel OR sourcecountry:Iran OR sourcecountry:Saudi Arabia)',
    Europe:   'sourcecountry:Ukraine OR sourcecountry:Russia OR sourcecountry:United Kingdom OR sourcecountry:Germany OR sourcecountry:France',
    Asia:     'sourcecountry:China OR sourcecountry:India OR sourcecountry:Taiwan OR sourcecountry:Japan',
    Americas: 'sourcecountry:United States OR sourcecountry:Mexico OR sourcecountry:Brazil',
    Africa:   'sourcecountry:Nigeria OR sourcecountry:Ethiopia OR sourcecountry:South Africa',
  };
  return filters[region] ?? '';
}
