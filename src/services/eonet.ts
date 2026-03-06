/**
 * NASA EONET Service (Earth Observatory Natural Event Tracker)
 * Free, no API key. Returns open natural events with coordinates.
 * https://eonet.gsfc.nasa.gov/docs/v3
 */

export interface EONETEvent {
  id: string;
  title: string;
  category: string;       // "Wildfires" | "Volcanoes" | "Earthquakes" | "Floods" | "Severe Storms" | etc.
  categoryId: string;     // snake_case id
  lat: number;
  lng: number;
  date: string;           // ISO date of first geometry
  url: string;            // EONET permalink
}

// Category → display colour (for MapView layer)
export const EONET_CATEGORY_COLOR: Record<string, string> = {
  wildfires:          '#ff6b35',
  volcanoes:          '#dc2626',
  earthquakes:        '#9333ea',
  floods:             '#2563eb',
  severe_storms:      '#0891b2',
  drought:            '#d97706',
  landslides:         '#78716c',
  sea_lake_ice:       '#7dd3fc',
  manmade:            '#6b7280',
  snow:               '#e2e8f0',
  temperature_extreme:'#f97316',
  dust_haze:          '#92400e',
};

export const EONET_CATEGORY_ICON: Record<string, string> = {
  wildfires:   '🔥',
  volcanoes:   '🌋',
  earthquakes: '⚡',
  floods:      '🌊',
  severe_storms: '🌪',
  drought:     '☀',
  landslides:  '⛰',
};

export async function fetchEONETEvents(): Promise<EONETEvent[]> {
  try {
    const res = await fetch('/api/eonet');
    if (!res.ok) throw new Error(`EONET ${res.status}`);
    const data = await res.json();

    const events: EONETEvent[] = [];

    for (const event of (data.events ?? [])) {
      const geometries: Array<{ date: string; type: string; coordinates: number[] | number[][][] }> =
        event.geometry ?? [];
      if (geometries.length === 0) continue;

      // Use the most recent geometry point
      const geo = geometries[geometries.length - 1];
      let lat = 0, lng = 0;

      if (geo.type === 'Point' && Array.isArray(geo.coordinates)) {
        // GeoJSON [lng, lat]
        lng = (geo.coordinates as number[])[0];
        lat = (geo.coordinates as number[])[1];
      } else if (geo.type === 'Polygon') {
        // Use centroid of first ring
        const ring = (geo.coordinates as number[][][])[0];
        lng = ring.reduce((s, p) => s + p[0], 0) / ring.length;
        lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
      }

      if (lat === 0 && lng === 0) continue;

      const category = event.categories?.[0] ?? {};
      const categoryId = ((category.id ?? '') as string).toLowerCase().replace(/\s+/g, '_');

      events.push({
        id: event.id,
        title: event.title,
        category: category.title ?? 'Natural Event',
        categoryId,
        lat,
        lng,
        date: geo.date ?? new Date().toISOString(),
        url: event.link ?? `https://eonet.gsfc.nasa.gov/events/${event.id}`,
      });
    }

    return events;
  } catch (err) {
    console.warn('[EONET] Failed to fetch events:', err);
    return [];
  }
}
