import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
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
  const { state, dispatch } = useApp();
  const { clusters, selectedCluster } = state;
  const [mapReady, setMapReady] = useState(false);
  const [conflictEvents, setConflictEvents] = useState<GdeltEvent[]>([]);

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
