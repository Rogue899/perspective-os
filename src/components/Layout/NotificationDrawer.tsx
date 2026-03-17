import { useApp } from '../../context/AppContext';
import { X, Bell, AlertCircle, Zap, ChevronRight, FlaskConical, Trophy, Cpu, Globe } from 'lucide-react';

export function NotificationDrawer({ onClose }: { onClose: () => void }) {
  const { state, dispatch } = useApp();
  const { keywordHits, clusters } = state;

  const critical = clusters
    .filter(c => c.severity === 'critical' || c.severity === 'high')
    .slice(0, 8);

  const scienceHealth = clusters
    .filter(c => c.category === 'science' || c.category === 'health')
    .slice(0, 5);

  const sports = clusters
    .filter(c => c.category === 'sport')
    .slice(0, 5);

  const techCyber = clusters
    .filter(c => c.category === 'tech' || c.category === 'cyber')
    .slice(0, 5);

  const diplomatic = clusters
    .filter(c => c.category === 'diplomatic' || c.category === 'economic')
    .slice(0, 4);

  const newHitCount = keywordHits.filter(h => h.isNew).length;

  return (
    <>
      {/* Backdrop — click outside to close */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Drawer */}
      <div className="fixed top-11 right-2 w-80 bg-surface border border-border rounded-b-lg shadow-2xl z-50 flex flex-col max-h-[72vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Bell size={12} className="text-accent" />
            <span className="text-[11px] font-mono font-semibold text-white">Notifications</span>
            {newHitCount > 0 && (
              <span className="text-[8px] font-mono bg-red-500 text-white px-1.5 py-0.5 rounded-full leading-none">
                {newHitCount}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {newHitCount > 0 && (
              <button
                onClick={() => dispatch({ type: 'MARK_KEYWORDS_READ' })}
                className="text-[9px] font-mono text-dim hover:text-white transition-colors"
              >
                Mark read
              </button>
            )}
            <button onClick={onClose} className="text-dim hover:text-white transition-colors">
              <X size={13} />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto flex-1 divide-y divide-border/40">
          {/* Critical / High alerts */}
          {critical.length > 0 && (
            <div>
              <div className="px-3 py-1.5 flex items-center gap-1.5 bg-red-500/5">
                <AlertCircle size={9} className="text-red-400" />
                <span className="text-[9px] font-mono text-red-400 uppercase tracking-wider">
                  Critical &amp; High Priority
                </span>
              </div>
              {critical.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    dispatch({ type: 'SELECT_CLUSTER', payload: c });
                    dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'analysis' });
                    onClose();
                  }}
                  className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-white/5 text-left transition-colors group border-b border-border/20"
                >
                  <span className={`shrink-0 text-[8px] font-mono mt-0.5 font-bold ${
                    c.severity === 'critical' ? 'text-red-400' : 'text-orange-400'
                  }`}>
                    {c.severity === 'critical' ? 'S5' : 'S4'}
                  </span>
                  <p className="text-[10px] text-white/80 line-clamp-2 leading-snug flex-1 group-hover:text-white">
                    {c.headline}
                  </p>
                  <ChevronRight size={9} className="text-dim shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

          {/* Keyword monitor hits */}
          {keywordHits.length > 0 && (
            <div>
              <div className="px-3 py-1.5 flex items-center gap-1.5 bg-accent/5">
                <Zap size={9} className="text-accent" />
                <span className="text-[9px] font-mono text-accent uppercase tracking-wider">
                  Keyword Monitor · {keywordHits.length} hits
                </span>
              </div>
              {keywordHits.slice(0, 25).map(hit => (
                <div
                  key={hit.id}
                  className={`flex items-start gap-2 px-3 py-2 border-b border-border/20 ${
                    hit.isNew ? 'bg-accent/5' : ''
                  }`}
                >
                  <span className="text-[10px] shrink-0 mt-0.5">
                    {hit.source === 'reddit' ? '🟠' : '📰'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-white/80 line-clamp-2 leading-snug">{hit.title}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[8px] font-mono text-dim border border-border/50 px-1 rounded">
                        {hit.keyword}
                      </span>
                      {hit.isNew && (
                        <span className="text-[8px] font-mono text-accent font-bold">NEW</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Science & Health */}
          {scienceHealth.length > 0 && (
            <div>
              <div className="px-3 py-1.5 flex items-center gap-1.5 bg-blue-500/5">
                <FlaskConical size={9} className="text-blue-400" />
                <span className="text-[9px] font-mono text-blue-400 uppercase tracking-wider">
                  Science &amp; Health
                </span>
              </div>
              {scienceHealth.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    dispatch({ type: 'SELECT_CLUSTER', payload: c });
                    dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'analysis' });
                    onClose();
                  }}
                  className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-white/5 text-left transition-colors group border-b border-border/20"
                >
                  <span className="shrink-0 text-[8px] font-mono mt-0.5 text-blue-400">
                    {c.category === 'health' ? '⚕' : '🔬'}
                  </span>
                  <p className="text-[10px] text-white/80 line-clamp-2 leading-snug flex-1 group-hover:text-white">
                    {c.headline}
                  </p>
                  <ChevronRight size={9} className="text-dim shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

          {/* Sports */}
          {sports.length > 0 && (
            <div>
              <div className="px-3 py-1.5 flex items-center gap-1.5 bg-accent/5">
                <Trophy size={9} className="text-accent" />
                <span className="text-[9px] font-mono text-accent uppercase tracking-wider">
                  Sports
                </span>
              </div>
              {sports.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    dispatch({ type: 'SELECT_CLUSTER', payload: c });
                    dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'analysis' });
                    onClose();
                  }}
                  className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-white/5 text-left transition-colors group border-b border-border/20"
                >
                  <span className="shrink-0 text-[8px] font-mono mt-0.5 text-green-400">🏆</span>
                  <p className="text-[10px] text-white/80 line-clamp-2 leading-snug flex-1 group-hover:text-white">
                    {c.headline}
                  </p>
                  <ChevronRight size={9} className="text-dim shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

          {/* Tech & Cyber */}
          {techCyber.length > 0 && (
            <div>
              <div className="px-3 py-1.5 flex items-center gap-1.5 bg-purple-500/5">
                <Cpu size={9} className="text-purple-400" />
                <span className="text-[9px] font-mono text-purple-400 uppercase tracking-wider">
                  Tech &amp; Cyber
                </span>
              </div>
              {techCyber.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    dispatch({ type: 'SELECT_CLUSTER', payload: c });
                    dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'analysis' });
                    onClose();
                  }}
                  className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-white/5 text-left transition-colors group border-b border-border/20"
                >
                  <span className="shrink-0 text-[8px] font-mono mt-0.5 text-purple-400">
                    {c.category === 'cyber' ? '🔐' : '💻'}
                  </span>
                  <p className="text-[10px] text-white/80 line-clamp-2 leading-snug flex-1 group-hover:text-white">
                    {c.headline}
                  </p>
                  <ChevronRight size={9} className="text-dim shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

          {/* Diplomacy & Economy */}
          {diplomatic.length > 0 && (
            <div>
              <div className="px-3 py-1.5 flex items-center gap-1.5 bg-amber-500/5">
                <Globe size={9} className="text-amber-400" />
                <span className="text-[9px] font-mono text-amber-400 uppercase tracking-wider">
                  Diplomacy &amp; Economy
                </span>
              </div>
              {diplomatic.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    dispatch({ type: 'SELECT_CLUSTER', payload: c });
                    dispatch({ type: 'SET_ACTIVE_PANEL', payload: 'analysis' });
                    onClose();
                  }}
                  className="w-full flex items-start gap-2 px-3 py-2.5 hover:bg-white/5 text-left transition-colors group border-b border-border/20"
                >
                  <span className="shrink-0 text-[8px] font-mono mt-0.5 text-amber-400">
                    {c.category === 'economic' ? '📈' : '🤝'}
                  </span>
                  <p className="text-[10px] text-white/80 line-clamp-2 leading-snug flex-1 group-hover:text-white">
                    {c.headline}
                  </p>
                  <ChevronRight size={9} className="text-dim shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                </button>
              ))}
            </div>
          )}

          {/* Empty state */}
          {critical.length === 0 && keywordHits.length === 0 &&
           scienceHealth.length === 0 && sports.length === 0 &&
           techCyber.length === 0 && diplomatic.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <Bell size={24} className="text-dim/20" />
              <span className="text-[11px] font-mono text-dim">No notifications yet</span>
              <span className="text-[10px] text-dim/60 px-4">
                Critical alerts and keyword monitor hits appear here
              </span>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
