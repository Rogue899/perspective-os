/**
 * Live Panel — multi-source live news grid
 * YouTube 24/7 streams via channel embed + real-time RSS ticker
 */

import { useState, useMemo } from 'react';
import { useApp } from '../../context/AppContext';
import { LIVE_CHANNELS, buildEmbedUrl, type GridLayout, LAYOUT_COUNTS } from '../../config/live-channels';
import { Maximize2, Minimize2, LayoutGrid, Volume2, VolumeX, RefreshCw } from 'lucide-react';

const BIAS_COLORS: Record<string, string> = {
  left:   'border-blue-500/40',
  center: 'border-gray-500/40',
  right:  'border-red-500/40',
  state:  'border-purple-500/40',
  gulf:   'border-amber-500/40',
};

const LAYOUT_OPTIONS: Array<{ id: GridLayout; label: string; cols: string; rows: string }> = [
  { id: 'single', label: '1',   cols: 'grid-cols-1', rows: '' },
  { id: '1x4',   label: '1×4', cols: 'grid-cols-1', rows: '' },
  { id: '2x2',   label: '2×2', cols: 'grid-cols-2', rows: '' },
  { id: '2x3',   label: '2×3', cols: 'grid-cols-2', rows: '' },
  { id: '3x2',   label: '3×2', cols: 'grid-cols-3', rows: '' },
];

export function LivePanel() {
  const { state } = useApp();
  const { clusters } = state;
  const [layout, setLayout] = useState<GridLayout>('2x2');
  const [muted, setMuted] = useState(true);
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(
    new Set(LIVE_CHANNELS.filter(c => c.enabled).map(c => c.id))
  );
  const [embedKey, setEmbedKey] = useState(0); // force refresh iframes

  const activeChannels = useMemo(() =>
    LIVE_CHANNELS.filter(c => enabledIds.has(c.id)).slice(0, LAYOUT_COUNTS[layout]),
    [enabledIds, layout]
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
          <div className="col-span-full flex items-center justify-center text-dim text-xs font-mono">
            No channels selected
          </div>
        ) : (
          activeChannels.map(ch => (
            <div
              key={`${ch.id}-${embedKey}`}
              className={`relative group border ${BIAS_COLORS[ch.bias]} border overflow-hidden bg-black`}
            >
              <iframe
                src={buildEmbedUrl(ch.channelId) + (muted ? '' : '&mute=0')}
                className="w-full h-full"
                allow="autoplay; encrypted-media; picture-in-picture"
                allowFullScreen
                title={ch.name}
              />
              {/* Overlay on hover */}
              <div className="absolute inset-0 flex items-end justify-between p-2 bg-gradient-to-t from-black/70 to-transparent opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                <div className="text-[10px] font-mono text-white/80">
                  {ch.name}
                  <span className="ml-1 text-white/40">· {ch.region}</span>
                </div>
                <button
                  onClick={() => setFullscreen(ch.id)}
                  className="pointer-events-auto bg-black/60 hover:bg-black/80 text-white p-1 rounded transition-colors"
                >
                  <Maximize2 size={11} />
                </button>
              </div>
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
