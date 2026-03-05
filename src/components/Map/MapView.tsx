import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { Locate, LocateFixed, LoaderCircle, MessageCircle, Video, X } from 'lucide-react';
import { fetchGdeltEvents } from '../../services/gdelt';
import { useApp } from '../../context/AppContext';
import type { GdeltEvent } from '../../types';

// Free tile source — no token needed
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/dark';

// Fallback if openfreemap is down
const FALLBACK_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap',
    },
  },
  layers: [{
    id: 'osm',
    type: 'raster' as const,
    source: 'osm',
  }],
};

const SEVERITY_COLORS: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#6b7280',
};

export function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const { state, dispatch } = useApp();
  const { clusters, selectedCluster } = state;
  const [mapReady, setMapReady] = useState(false);
  const [conflictEvents, setConflictEvents] = useState<GdeltEvent[]>([]);
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'located' | 'error'>('idle');
  const [geoError, setGeoError] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [floatingLocation, setFloatingLocation] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [floatingTab, setFloatingTab] = useState<'news' | 'video'>('news');

  const distanceKm = useCallback((aLat: number, aLng: number, bLat: number, bLng: number) => {
    const toRad = (v: number) => (v * Math.PI) / 180;
    const dLat = toRad(bLat - aLat);
    const dLng = toRad(bLng - aLng);
    const x = Math.sin(dLat / 2) ** 2
      + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
  }, []);

  const getLocationStories = useCallback((lat: number, lng: number, name?: string) => {
    const withGeo = clusters.filter(c => c.geoHint);
    const exact = name
      ? withGeo.filter(c => c.geoHint?.name.toLowerCase() === name.toLowerCase())
      : [];

    const nearby = withGeo
      .map(c => ({
        cluster: c,
        dist: distanceKm(lat, lng, c.geoHint!.lat, c.geoHint!.lng),
      }))
      .filter(v => v.dist <= 600)
      .sort((a, b) => a.dist - b.dist)
      .map(v => v.cluster);

    const merged = [...exact, ...nearby].filter((value, index, arr) => arr.findIndex(v => v.id === value.id) === index);
    return merged.slice(0, 6);
  }, [clusters, distanceKm]);

  const locateMe = useCallback(() => {
    if (!map.current || !mapReady) return;
    if (!navigator.geolocation) {
      setGeoError('Geolocation not supported');
      setGeoState('error');
      return;
    }
    setGeoState('loading');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;

        // Remove old user marker
        userMarkerRef.current?.remove();

        // Pulsing "you are here" dot
        const el = document.createElement('div');
        el.className = 'user-location-marker';
        el.innerHTML = `
          <div style="position:relative;width:20px;height:20px;display:flex;align-items:center;justify-content:center">
            <div style="
              position:absolute;width:20px;height:20px;border-radius:50%;
              background:rgba(59,130,246,0.25);border:1px solid rgba(59,130,246,0.5);
              animation:pos-ping 1.5s ease-out infinite;
            "></div>
            <div style="
              width:10px;height:10px;border-radius:50%;
              background:#3b82f6;border:2px solid white;
              box-shadow:0 0 8px #3b82f680;
              z-index:1;
            "></div>
          </div>
        `;

        // Accuracy circle
        if (map.current!.getSource('user-accuracy')) {
          (map.current!.getSource('user-accuracy') as maplibregl.GeoJSONSource).setData({
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [lng, lat] },
            properties: {},
          });
        } else if (map.current!.isStyleLoaded()) {
          try {
            map.current!.addSource('user-accuracy', {
              type: 'geojson',
              data: { type: 'Feature', geometry: { type: 'Point', coordinates: [lng, lat] }, properties: {} },
            });
            map.current!.addLayer({
              id: 'user-accuracy-circle',
              type: 'circle',
              source: 'user-accuracy',
              paint: {
                'circle-radius': Math.min(accuracy / 2, 80),
                'circle-color': '#3b82f6',
                'circle-opacity': 0.08,
                'circle-stroke-width': 1,
                'circle-stroke-color': '#3b82f6',
                'circle-stroke-opacity': 0.25,
              },
            });
          } catch { /* style may not support it */ }
        }

        const popup = new maplibregl.Popup({ offset: 14, closeButton: false, className: 'pos-popup' })
          .setHTML(`<div style="font-family:monospace;font-size:11px;padding:6px;color:white">
            <div style="color:#3b82f6;font-size:9px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:3px">You are here</div>
            <div style="color:#9ca3af;font-size:9px">±${Math.round(accuracy)}m accuracy</div>
          </div>`);

        userMarkerRef.current = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map.current!);

        map.current!.flyTo({ center: [lng, lat], zoom: 6, duration: 1800 });
        setUserCoords({ lat, lng });
        setFloatingLocation({ name: 'Near you', lat, lng });
        setFloatingTab('news');
        setGeoState('located');
        setGeoError('');
      },
      (err) => {
        setGeoState('error');
        setGeoError(err.code === 1 ? 'Location access denied' : 'Could not get location');
        setTimeout(() => setGeoState('idle'), 3000);
      },
      { enableHighAccuracy: true, timeout: 12000 }
    );
  }, [mapReady]);

  // Init map
  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const m = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: [20, 20],
      zoom: 2,
      attributionControl: false,
    });

    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    m.on('load', () => {
      setMapReady(true);
    });

    m.on('error', () => {
      // Fallback to OSM raster
      m.setStyle(FALLBACK_STYLE as any);
    });

    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
  }, []);

  // Fetch GDELT conflict events
  useEffect(() => {
    if (!mapReady) return;
    fetchGdeltEvents().then(events => {
      setConflictEvents(events.slice(0, 200));
    });
  }, [mapReady]);

  // Render story cluster markers
  useEffect(() => {
    if (!map.current || !mapReady) return;

    // Clear old markers
    markersRef.current.forEach(m => m.remove());
    markersRef.current = [];

    // Add cluster markers for stories with geo hints
    clusters
      .filter(c => c.geoHint)
      .forEach(cluster => {
        const { lat, lng } = cluster.geoHint!;
        const isSelected = selectedCluster?.id === cluster.id;
        const color = cluster.severity === 'critical' ? '#ef4444'
                    : cluster.severity === 'high'     ? '#f59e0b'
                    : '#22c55e';

        const el = document.createElement('div');
        el.className = 'cluster-marker';
        el.style.cssText = `
          width: ${isSelected ? '16px' : '10px'};
          height: ${isSelected ? '16px' : '10px'};
          border-radius: 50%;
          background: ${color};
          border: 2px solid ${isSelected ? 'white' : 'rgba(255,255,255,0.3)'};
          cursor: pointer;
          transition: all 0.2s;
          box-shadow: 0 0 ${cluster.perspectiveScore > 0.4 ? '8px' : '4px'} ${color}80;
        `;

        const popup = new maplibregl.Popup({
          offset: 12,
          closeButton: false,
          className: 'pos-popup',
        }).setHTML(`
          <div style="font-family:monospace;font-size:11px;max-width:220px;padding:6px">
            <div style="color:${color};font-size:9px;text-transform:uppercase;letter-spacing:0.05em;margin-bottom:4px">
              ${cluster.category} · ${cluster.severity}
            </div>
            <div style="color:white;line-height:1.3;margin-bottom:4px">${cluster.headline}</div>
            <div style="color:#6b7280;font-size:9px">${cluster.sourceIds.length} sources · click to analyze</div>
          </div>
        `);

        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(popup)
          .addTo(map.current!);

        el.addEventListener('click', () => {
          dispatch({ type: 'SELECT_CLUSTER', payload: cluster });
          if (cluster.geoHint) {
            setFloatingLocation({
              name: cluster.geoHint.name,
              lat: cluster.geoHint.lat,
              lng: cluster.geoHint.lng,
            });
            setFloatingTab('news');
          }
        });

        markersRef.current.push(marker);
      });
  }, [clusters, mapReady, selectedCluster, dispatch]);

  // Fly to selected cluster
  useEffect(() => {
    if (!map.current || !selectedCluster?.geoHint || !mapReady) return;
    const { lat, lng } = selectedCluster.geoHint;
    map.current.flyTo({ center: [lng, lat], zoom: 5, duration: 1500 });
  }, [selectedCluster, mapReady]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Floating city brief window */}
      {floatingLocation && (
        <div className="absolute left-3 bottom-10 w-[320px] max-w-[calc(100vw-1.5rem)] bg-surface/95 border border-border rounded-lg shadow-2xl z-20 overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border">
            <div className="flex items-center gap-2 min-w-0">
              <MessageCircle size={12} className="text-accent shrink-0" />
              <span className="text-[11px] font-mono text-white truncate">
                {floatingLocation.name} Brief
              </span>
            </div>
            <button
              onClick={() => setFloatingLocation(null)}
              className="text-dim hover:text-white"
              title="Close city brief"
            >
              <X size={12} />
            </button>
          </div>

          <div className="px-2 pt-2 pb-1 border-b border-border flex gap-1">
            <button
              onClick={() => setFloatingTab('news')}
              className={`px-2 py-1 text-[10px] font-mono rounded ${floatingTab === 'news' ? 'bg-accent/15 text-accent border border-accent/30' : 'text-dim hover:text-white hover:bg-white/5 border border-transparent'}`}
            >
              News
            </button>
            <button
              onClick={() => setFloatingTab('video')}
              className={`px-2 py-1 text-[10px] font-mono rounded ${floatingTab === 'video' ? 'bg-accent/15 text-accent border border-accent/30' : 'text-dim hover:text-white hover:bg-white/5 border border-transparent'}`}
            >
              Video
            </button>
          </div>

          {floatingTab === 'news' ? (
            <div className="p-2.5 max-h-[260px] overflow-y-auto space-y-2">
              {getLocationStories(floatingLocation.lat, floatingLocation.lng, floatingLocation.name).length === 0 ? (
                <div className="text-[10px] text-dim font-mono">
                  No mapped headlines yet for this location.
                </div>
              ) : (
                getLocationStories(floatingLocation.lat, floatingLocation.lng, floatingLocation.name).map(cluster => (
                  <button
                    key={cluster.id}
                    onClick={() => dispatch({ type: 'SELECT_CLUSTER', payload: cluster })}
                    className="w-full text-left p-2 rounded border border-border hover:border-accent/40 hover:bg-white/5 transition-colors"
                  >
                    <div className="text-[9px] text-dim font-mono mb-1 uppercase tracking-wider">
                      {cluster.category} · {cluster.sourceIds.length} sources
                    </div>
                    <div className="text-[11px] text-white leading-snug line-clamp-2">
                      {cluster.headline}
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : (
            <div className="p-2.5 space-y-2">
              <div className="text-[10px] text-dim font-mono">Local video searches</div>
              <a
                href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${floatingLocation.name} latest news`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded border border-border hover:border-red-500/40 hover:bg-red-500/5 text-[11px] text-white"
              >
                <Video size={12} className="text-red-400" />
                YouTube: {floatingLocation.name} latest news
              </a>
              <a
                href={`https://rumble.com/search/video?q=${encodeURIComponent(`${floatingLocation.name} news`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 p-2 rounded border border-border hover:border-green-500/40 hover:bg-green-500/5 text-[11px] text-white"
              >
                <Video size={12} className="text-green-400" />
                Rumble: {floatingLocation.name} news
              </a>
              {userCoords && (
                <div className="text-[9px] text-dim font-mono pt-1 border-t border-border">
                  Personalized from your geolocation
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Locate Me button */}
      <div className="absolute bottom-10 right-3 flex flex-col gap-2">
        <button
          onClick={locateMe}
          disabled={geoState === 'loading'}
          title={
            geoState === 'located' ? 'Re-center on your location' :
            geoState === 'error'   ? geoError :
            'Locate me'
          }
          className={`
            w-8 h-8 rounded flex items-center justify-center border transition-all
            ${geoState === 'located'  ? 'bg-blue-500/20 border-blue-500/60 text-blue-400' :
              geoState === 'error'    ? 'bg-red-500/20  border-red-500/40  text-red-400' :
              geoState === 'loading'  ? 'bg-surface      border-border       text-accent' :
                                        'bg-surface      border-border       text-dim hover:text-white hover:border-accent'}
          `}
        >
          {geoState === 'loading' ? (
            <LoaderCircle size={14} className="animate-spin" />
          ) : geoState === 'located' ? (
            <LocateFixed size={14} />
          ) : (
            <Locate size={14} />
          )}
        </button>
      </div>

      {/* Error toast */}
      {geoState === 'error' && geoError && (
        <div className="absolute bottom-20 right-3 bg-red-900/80 border border-red-500/40 rounded px-2.5 py-1.5 text-[10px] font-mono text-red-300 max-w-[160px] text-center">
          {geoError}
        </div>
      )}

      {/* Pulse animation */}
      <style>{`
        @keyframes pos-ping {
          0%   { transform: scale(1);   opacity: 0.8; }
          100% { transform: scale(3.5); opacity: 0; }
        }
      `}</style>

      {/* Legend */}
      <div className="absolute top-3 left-3 bg-surface/90 border border-border rounded p-2.5 text-[10px] font-mono space-y-1.5">
        <div className="text-dim uppercase tracking-wider mb-1">Conflict markers</div>
        {[
          { label: 'Critical', color: '#ef4444' },
          { label: 'High',     color: '#f59e0b' },
          { label: 'Active',   color: '#22c55e' },
        ].map(({ label, color }) => (
          <div key={label} className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
            <span className="text-dim">{label}</span>
          </div>
        ))}
        <div className="border-t border-border pt-1.5 text-dim">
          {clusters.filter(c => c.geoHint).length} stories mapped
        </div>
      </div>
    </div>
  );
}
