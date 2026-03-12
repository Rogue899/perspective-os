/**
 * Live Panel — multi-source live news grid
 * YouTube 24/7 streams via channel embed + real-time RSS ticker
 */

import { useState, useMemo, useEffect } from 'react';
import { useApp } from '../../context/AppContext';
import { LIVE_CHANNELS, buildEmbedUrl, type GridLayout, LAYOUT_COUNTS } from '../../config/live-channels';
import { discoverLiveChannelsForLocation } from '../../services/live-discovery';
import { Maximize2, Minimize2, LayoutGrid, Volume2, VolumeX, RefreshCw, MessageCircle, X } from 'lucide-react';

const BIAS_COLORS: Record<string, string> = {
  left:   'border-blue-500/40',
  center: 'border-gray-500/40',
  right:  'border-red-500/40',
  state:  'border-purple-500/40',
  gulf:   'border-amber-500/40',
};

const LAYOUT_OPTIONS: Array<{ id: GridLayout; label: string; cols: string }> = [
  { id: 'single', label: '1',   cols: 'grid-cols-1' },
  { id: '1x4',   label: '1×4', cols: 'grid-cols-1' },
  { id: '2x2',   label: '2×2', cols: 'grid-cols-2' },
  { id: '2x3',   label: '2×3', cols: 'grid-cols-2' },
  { id: '3x2',   label: '3×2', cols: 'grid-cols-3' },
  { id: '3x3',   label: '3×3', cols: 'grid-cols-3' },
  { id: '4x2',   label: '4×2', cols: 'grid-cols-4' },
];

export function LivePanel() {
  const { state, dispatch } = useApp();
  const { clusters, locationFilter } = state;
  const [layout, setLayout] = useState<GridLayout>('2x2');
  const [muted, setMuted] = useState(true);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(
    new Set(LIVE_CHANNELS.filter(c => c.enabled).map(c => c.id))
  );
  const [discoveredOrder, setDiscoveredOrder] = useState<string[]>([]);
  const [discovering, setDiscovering] = useState(false);
  const [fallbackUsed, setFallbackUsed] = useState(false);
  const [embedKey, setEmbedKey] = useState(0); // force refresh iframes

  useEffect(() => {
    let cancelled = false;
    if (!locationFilter) {
      setDiscoveredOrder([]);
      setFallbackUsed(false);
      return;
    }

    setDiscovering(true);
    discoverLiveChannelsForLocation({
      lat: locationFilter.lat,
      lng: locationFilter.lng,
      locationName: locationFilter.name,
      topic: clusters[0]?.headline,
    })
      .then(result => {
        if (cancelled) return;
        setDiscoveredOrder(result.channels.map(c => c.id));
        setFallbackUsed(result.fallbackUsed);
      })
      .catch(() => {
        if (cancelled) return;
        setDiscoveredOrder([]);
        setFallbackUsed(true);
      })
      .finally(() => {
        if (!cancelled) setDiscovering(false);
      });

    return () => { cancelled = true; };
  }, [locationFilter?.lat, locationFilter?.lng, locationFilter?.name, clusters]);

  const activeChannels = useMemo(() =>
    (locationFilter && discoveredOrder.length > 0
      ? discoveredOrder.map(id => LIVE_CHANNELS.find(c => c.id === id)).filter((c): c is typeof LIVE_CHANNELS[number] => Boolean(c))
      : LIVE_CHANNELS
    )
      .filter(c => enabledIds.has(c.id))
      .slice(0, LAYOUT_COUNTS[layout]),
    [enabledIds, layout, locationFilter, discoveredOrder]
  );

  const gridClass = LAYOUT_OPTIONS.find(l => l.id === layout)?.cols ?? 'grid-cols-2';

  const toggleChannel = (id: string) => {
    setEnabledIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Latest headlines ticker from clusters
  const tickerItems = clusters.slice(0, 20).map(c => c.headline);

  if (fullscreen) {
    const ch = LIVE_CHANNELS.find(c => c.id === fullscreen);
    if (ch) return (
      <div className="w-full h-full relative bg-black">
        <iframe
          key={`${embedKey}-fs`}
          src={buildEmbedUrl(ch.channelId) + (muted ? '' : '&mute=0')}
          className="w-full h-full"
          allow="autoplay; encrypted-media; picture-in-picture"
          allowFullScreen
        />
        <div className="absolute top-3 right-3 flex gap-2">
          <button
            onClick={() => setMuted(!muted)}
            className="bg-black/60 hover:bg-black/80 text-white p-2 rounded-lg transition-colors"
          >
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <button
            onClick={() => setFullscreen(null)}
            className="bg-black/60 hover:bg-black/80 text-white p-2 rounded-lg transition-colors"
          >
            <Minimize2 size={16} />
          </button>
        </div>
        <div className="absolute bottom-0 left-0 right-0 bg-black/80 text-[10px] font-mono text-white/70 px-3 py-1.5">
          {ch.name} · {ch.region} · Live
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-bg">
      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 shrink-0 flex-wrap">
        <span className="text-[10px] font-mono text-dim flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          LIVE
        </span>

        {/* Layout selector */}
        <div className="flex gap-1">
          {LAYOUT_OPTIONS.map(l => (
            <button
              key={l.id}
              onClick={() => setLayout(l.id)}
              className={`px-2 py-0.5 text-[9px] font-mono rounded transition-colors ${
                layout === l.id
                  ? 'bg-accent/10 text-accent border border-accent/30'
                  : 'text-dim hover:text-white hover:bg-white/5'
              }`}
            >
              {l.label}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <button
          onClick={() => setMuted(!muted)}
          className="text-dim hover:text-white transition-colors"
          title={muted ? 'Unmute' : 'Mute all'}
        >
          {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
        </button>
        <button
          onClick={() => setEmbedKey(k => k + 1)}
          className="text-dim hover:text-white transition-colors"
          title="Refresh streams"
        >
          <RefreshCw size={13} />
        </button>
        <LayoutGrid size={13} className="text-dim" />
        {locationFilter && (
          <span className="text-[9px] font-mono text-accent/80">
            {discovering ? 'Discovering local channels…' : `Local: ${locationFilter.name}${fallbackUsed ? ' (fallback)' : ''}`}
          </span>
        )}
      </div>

      {/* Channel toggles */}
      <div className="px-3 py-1.5 border-b border-border/60 flex gap-1.5 overflow-x-auto shrink-0">
        {LIVE_CHANNELS.map(ch => (
          <button
            key={ch.id}
            onClick={() => toggleChannel(ch.id)}
            className={`px-2 py-0.5 text-[9px] font-mono rounded border whitespace-nowrap transition-colors ${
              enabledIds.has(ch.id)
                ? `${BIAS_COLORS[ch.bias]} bg-white/5 text-white`
                : 'border-transparent text-dim hover:text-white/60'
            }`}
          >
            {ch.name}
            {ch.id.includes('rt') || ch.id.includes('cgtn') ? ' ⚠️' : ''}
          </button>
        ))}
      </div>

      {/* Video grid */}
      <div className={`flex-1 grid ${gridClass} gap-0.5 bg-black overflow-hidden`}>
        {activeChannels.length === 0 ? (
          <div className="col-span-full flex flex-col items-center justify-center text-dim text-xs font-mono gap-2">
            <span>No channels selected</span>
            <a
              href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${locationFilter?.name ?? 'world'} live news`)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2 py-1 rounded border border-border hover:border-accent/40 hover:text-white"
            >
              Any-source live fallback
            </a>
          </div>
        ) : (
          activeChannels.map((ch, idx) => (
            <div
              key={`${ch.id}-${embedKey}`}
              className={`relative group border ${BIAS_COLORS[ch.bias]} border overflow-hidden bg-black flex flex-col`}
            >
              {/* Channel header bar — always visible, shows which stream you're watching */}
              <div className={`flex items-center justify-between px-2 py-1 bg-black/90 border-b border-white/10 shrink-0`}>
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse shrink-0" />
                  <span className="text-[9px] font-mono text-white/90 truncate">{ch.name}</span>
                  <span className="text-[8px] font-mono text-white/40 shrink-0">{ch.region}</span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => setActiveChat(activeChat === ch.id ? null : ch.id)}
                    className={`p-1 rounded transition-colors ${
                      activeChat === ch.id
                        ? 'bg-accent/20 text-accent'
                        : 'bg-black/40 hover:bg-black/80 text-white/60 hover:text-white'
                    }`}
                    title="Related stories & AI analysis"
                  >
                    <MessageCircle size={10} />
                  </button>
                  <button
                    onClick={() => setFullscreen(ch.id)}
                    className="bg-black/40 hover:bg-black/80 text-white/60 hover:text-white p-1 rounded transition-colors"
                    title="Fullscreen"
                  >
                    <Maximize2 size={10} />
                  </button>
                </div>
              </div>
              {/* Stream number badge */}
              <div className="absolute top-7 left-2 text-[8px] font-mono text-white/30 pointer-events-none">
                #{idx + 1}
              </div>
              <iframe
                src={buildEmbedUrl(ch.channelId) + (muted ? '' : '&mute=0')}
                className="w-full flex-1 min-h-0"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title={ch.name}
              />
              {/* Chat / related stories drawer */}
              {activeChat === ch.id && (() => {
                const related = clusters.filter(c =>
                  c.headline.toLowerCase().includes(ch.name.toLowerCase().split(' ')[0]) ||
                  c.headline.toLowerCase().includes(ch.region.toLowerCase()) ||
                  c.articles.some(a => a.title.toLowerCase().includes(ch.region.toLowerCase()))
                ).slice(0, 8);
                return (
                  <div className="absolute inset-0 bg-black/95 flex flex-col z-20">
                    <div className="flex items-center justify-between px-2 py-1.5 border-b border-white/10">
                      <span className="text-[9px] font-mono text-accent">{ch.name} · Related</span>
                      <button onClick={() => setActiveChat(null)} className="text-dim hover:text-white"><X size={11} /></button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-1.5 space-y-1">
                      {related.length === 0 ? (
                        <span className="text-[9px] text-dim font-mono p-2 block">No related stories loaded yet</span>
                      ) : related.map(cluster => (
                        <button
                          key={cluster.id}
                          onClick={() => {
                            dispatch({ type: 'SELECT_CLUSTER', payload: cluster });
                            dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'analysis' });
                          }}
                          className="w-full text-left px-2 py-1.5 text-[9px] font-mono text-white/80 hover:text-white hover:bg-white/10 rounded transition-colors leading-snug"
                        >
                          {cluster.headline}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </div>
          ))
        )}
      </div>

      {/* Live headline ticker */}
      <div className="h-7 bg-surface border-t border-border flex items-center gap-3 shrink-0 overflow-hidden">
        <div className="shrink-0 px-3 text-[9px] font-mono text-red-400 border-r border-border">
          ● BREAKING
        </div>
        <div className="flex-1 overflow-hidden">
          <div className="flex gap-8 animate-marquee whitespace-nowrap text-[10px] font-mono text-dim">
            {tickerItems.map((h, i) => (
              <span key={i} className="hover:text-white cursor-default">{h}</span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
