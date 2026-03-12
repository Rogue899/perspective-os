import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { Locate, LocateFixed, LoaderCircle, MessageCircle, X } from 'lucide-react';
import { fetchGdeltEvents } from '../../services/gdelt';
import { fetchEONETEvents, EONET_CATEGORY_COLOR, EONET_CATEGORY_ICON } from '../../services/eonet';
import { discoverLiveChannelsForLocation } from '../../services/live-discovery';
import type { EONETEvent } from '../../services/eonet';
import { useApp } from '../../context/AppContext';
import type { GdeltEvent } from '../../types';
import { buildEmbedUrl } from '../../config/live-channels';

interface RegionChannel { id: string; name: string; channelId: string; reason?: string; }

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
  const [eonetEvents, setEonetEvents] = useState<EONETEvent[]>([]);
  const [geoState, setGeoState] = useState<'idle' | 'loading' | 'located' | 'error'>('idle');
  const [geoError, setGeoError] = useState('');
  const [userCoords, setUserCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [floatingLocation, setFloatingLocation] = useState<{ name: string; lat: number; lng: number } | null>(null);
  const [floatingTab, setFloatingTab] = useState<'news' | 'video'>('news');
  const [activeVideoChannel, setActiveVideoChannel] = useState<string | null>(null);
  const [regionChannels, setRegionChannels] = useState<RegionChannel[]>([]);
  const [discoveringChannels, setDiscoveringChannels] = useState(false);
  const [channelFallback, setChannelFallback] = useState(false);

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

    // Use tighter radius for user's own location (name==='Near you'), wider for clicked cities
    const radiusKm = name === 'Near you' ? 150 : 600;
    const nearby = withGeo
      .map(c => ({
        cluster: c,
        dist: distanceKm(lat, lng, c.geoHint!.lat, c.geoHint!.lng),
      }))
      .filter(v => v.dist <= radiusKm)
      .sort((a, b) => a.dist - b.dist)
      .map(v => v.cluster);

    const merged = [...exact, ...nearby].filter((value, index, arr) => arr.findIndex(v => v.id === value.id) === index);
    return merged.slice(0, 6);
  }, [clusters, distanceKm]);

  useEffect(() => {
    let cancelled = false;
    if (!floatingLocation) {
      setRegionChannels([]);
      setActiveVideoChannel(null);
      return;
    }

    setDiscoveringChannels(true);
    discoverLiveChannelsForLocation({
      lat: floatingLocation.lat,
      lng: floatingLocation.lng,
      locationName: floatingLocation.name,
      topic: getLocationStories(floatingLocation.lat, floatingLocation.lng, floatingLocation.name)[0]?.headline,
    })
      .then(result => {
        if (cancelled) return;
        setRegionChannels(result.channels.map(c => ({
          id: c.id,
          name: c.name,
          channelId: c.channelId,
          reason: c.reason,
        })));
        setChannelFallback(result.fallbackUsed);
        setActiveVideoChannel(result.channels[0]?.id ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setRegionChannels([]);
        setChannelFallback(true);
      })
      .finally(() => {
        if (!cancelled) setDiscoveringChannels(false);
      });

    return () => { cancelled = true; };
  }, [floatingLocation?.lat, floatingLocation?.lng, floatingLocation?.name, getLocationStories]);

  const platformShort: Record<string, string> = {
    youtube: 'YouTube',
    rumble:  'Rumble',
    kick:    'Kick',
    reddit:  'Reddit',
    x:       'X',
  };

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

        map.current!.flyTo({ center: [lng, lat], zoom: 9, duration: 1800 });
        setUserCoords({ lat, lng });
        setFloatingLocation({ name: 'Near you', lat, lng });
        setFloatingTab('news');
        // Sync feed panel to user's location
        dispatch({ type: 'SET_LOCATION_FILTER', payload: { name: 'Near you', lat, lng } });
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

    // Right-click → reverse geocode → show area news popup + sync feed
    m.on('contextmenu', async (ev) => {
      ev.preventDefault?.();
      const { lat, lng } = ev.lngLat;
      try {
        const resp = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=6`,
          { headers: { 'Accept-Language': 'en' } }
        );
        const data = await resp.json();
        const name =
          data.address?.city       ||
          data.address?.town       ||
          data.address?.state      ||
          data.address?.country    ||
          'this area';
        setFloatingLocation({ name, lat, lng });
        setFloatingTab('news');
        // Sync left feed panel to this location
        dispatch({ type: 'SET_LOCATION_FILTER', payload: { name, lat, lng } });
      } catch {
        setFloatingLocation({ name: 'this area', lat, lng });
        setFloatingTab('news');
        dispatch({ type: 'SET_LOCATION_FILTER', payload: { name: 'this area', lat, lng } });
      }
    });

    // Pointer cursor on hover over map canvas (indicates right-click is available)
    m.getCanvas().title = 'Right-click anywhere to get news for that area';

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

  // Fetch NASA EONET natural events
  useEffect(() => {
    if (!mapReady) return;
    fetchEONETEvents().then(events => {
      setEonetEvents(events);
    });
  }, [mapReady]);

  // Render GDELT conflict event dots (separate from story cluster markers)
  useEffect(() => {
    if (!map.current || !mapReady || conflictEvents.length === 0) return;
    if (!map.current.isStyleLoaded()) return;

    // Remove old GeoJSON source/layer if exists
    try { map.current.removeLayer('gdelt-events'); } catch {}
    try { map.current.removeSource('gdelt-events'); } catch {}

    const features = conflictEvents.map(e => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] },
      properties: {
        tone: e.tone,
        actor1: e.actor1,
        actor2: e.actor2,
        mentions: e.mentionCount,
      },
    }));

    try {
      map.current.addSource('gdelt-events', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.current.addLayer({
        id: 'gdelt-events',
        type: 'circle',
        source: 'gdelt-events',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'mentions'], 1, 3, 50, 7],
          'circle-color': ['interpolate', ['linear'], ['get', 'tone'], -10, '#ef4444', 0, '#f59e0b', 10, '#6b7280'],
          'circle-opacity': 0.45,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(255,255,255,0.2)',
        },
      });
    } catch { /* style not ready */ }
  }, [conflictEvents, mapReady]);

  // Render NASA EONET natural event dots
  useEffect(() => {
    if (!map.current || !mapReady || eonetEvents.length === 0) return;
    if (!map.current.isStyleLoaded()) return;

    try { map.current.removeLayer('eonet-events'); } catch {}
    try { map.current.removeSource('eonet-events'); } catch {}

    const features = eonetEvents.map(e => ({
      type: 'Feature' as const,
      geometry: { type: 'Point' as const, coordinates: [e.lng, e.lat] },
      properties: {
        title:    e.title,
        category: e.categoryId,
        color:    EONET_CATEGORY_COLOR[e.categoryId] ?? '#10b981',
        url:      e.url,
        icon:     EONET_CATEGORY_ICON[e.categoryId] ?? '⚠',
      },
    }));

    try {
      map.current.addSource('eonet-events', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });
      map.current.addLayer({
        id: 'eonet-events',
        type: 'circle',
        source: 'eonet-events',
        paint: {
          'circle-radius': 6,
          'circle-color': ['get', 'color'],
          'circle-opacity': 0.75,
          'circle-stroke-width': 1.5,
          'circle-stroke-color': 'rgba(255,255,255,0.3)',
        },
      });

      // Popup on click
      map.current.on('click', 'eonet-events', (ev) => {
        const props = ev.features?.[0]?.properties;
        if (!props) return;
        new maplibregl.Popup({ closeButton: true, className: 'pos-popup' })
          .setLngLat(ev.lngLat)
          .setHTML(`<div style="font-family:monospace;font-size:11px;padding:6px;max-width:200px">
            <div style="color:#10b981;font-size:9px;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px">
              ${props.icon ?? '⚠'} ${props.category ?? 'event'} · NASA EONET
            </div>
            <div style="color:white;margin-bottom:4px">${props.title}</div>
            <a href="${props.url}" target="_blank" style="color:#06b6d4;font-size:9px">View on EONET ↗</a>
          </div>`)
          .addTo(map.current!);
      });

      map.current.on('mouseenter', 'eonet-events', () => {
        if (map.current) map.current.getCanvas().style.cursor = 'pointer';
      });
      map.current.on('mouseleave', 'eonet-events', () => {
        if (map.current) map.current.getCanvas().style.cursor = '';
      });
    } catch { /* style not ready */ }
  }, [eonetEvents, mapReady]);

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
            const loc = {
              name: cluster.geoHint.name,
              lat: cluster.geoHint.lat,
              lng: cluster.geoHint.lng,
            };
            setFloatingLocation(loc);
            setFloatingTab('news');
            // Sync feed panel to cluster's location
            dispatch({ type: 'SET_LOCATION_FILTER', payload: loc });
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
              onClick={() => { setFloatingLocation(null); dispatch({ type: 'SET_LOCATION_FILTER', payload: null }); }}
              className="text-dim hover:text-white"
              title="Close — reset feed to global"
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
              {discoveringChannels && (
                <div className="text-[10px] text-dim font-mono animate-pulse">Finding local live channels…</div>
              )}
              {/* Channel tabs */}
              <div className="flex gap-1 flex-wrap pb-2 border-b border-border mb-2">
                {regionChannels.map(ch => {
                  const isActive = (activeVideoChannel ?? regionChannels[0]?.id) === ch.id;
                  return (
                    <button
                      key={ch.id}
                      onClick={() => setActiveVideoChannel(ch.id)}
                      className={`px-2 py-1 text-[10px] font-mono rounded border transition-colors ${
                        isActive ? 'bg-accent/15 text-accent border-accent/30' : 'text-dim hover:text-white border-border hover:border-accent/40'
                      }`}
                    >
                      {ch.name}
                    </button>
                  );
                })}
              </div>
              {/* Embedded player */}
              {(() => {
                const active = regionChannels.find(c => c.id === (activeVideoChannel ?? regionChannels[0]?.id)) ?? regionChannels[0];
                if (!active) {
                  return (
                    <div className="text-[10px] text-dim font-mono py-4 text-center space-y-2">
                      <div>No channels available for this location yet.</div>
                      <a
                        href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${floatingLocation.name} live news`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border hover:border-accent/40 hover:text-white"
                      >
                        Any-source fallback search
                      </a>
                    </div>
                  );
                }
                return (
                  <div className="rounded overflow-hidden border border-border bg-black/40">
                    <div className="px-2 py-1 border-b border-border text-[10px] font-mono text-dim flex items-center justify-between">
                      <span>▶ {active.name} — Live</span>
                      <span className="text-[9px] opacity-50">{channelFallback ? 'Fallback ranking' : 'AI-ranked local'}</span>
                    </div>
                    <iframe
                      key={active.channelId}
                      src={`${buildEmbedUrl(active.channelId)}&autoplay=1&mute=1`}
                      className="w-full h-48"
                      allow="autoplay; encrypted-media; picture-in-picture"
                      allowFullScreen
                      title={active.name}
                    />
                  </div>
                );
              })()}
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
        {eonetEvents.length > 0 && (
          <>
            <div className="border-t border-border pt-1.5 text-dim uppercase tracking-wider">
              Natural events ({eonetEvents.length})
            </div>
            {Object.entries(
              eonetEvents.reduce<Record<string, number>>((acc, e) => {
                acc[e.categoryId] = (acc[e.categoryId] ?? 0) + 1;
                return acc;
              }, {})
            ).slice(0, 5).map(([catId, count]) => (
              <div key={catId} className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: EONET_CATEGORY_COLOR[catId] ?? '#10b981' }} />
                <span className="text-dim">
                  {EONET_CATEGORY_ICON[catId] ?? '⚠'} {catId.replace(/_/g, ' ')} ({count})
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
