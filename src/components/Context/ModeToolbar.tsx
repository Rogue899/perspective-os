/**
 * ModeToolbar.tsx
 *
 * Three-button mode toggle (causal / compare / drill) + perspective lens chips.
 * Enforces: causal = 1 active lens, compare = exactly 2, drill = any.
 */

import type { PerspectiveLens } from '../../services/history-graph-adapter';

type HistoryMode = 'causal' | 'compare' | 'drill';

const MODE_LABELS: Record<HistoryMode, string> = {
  causal:  'Causal',
  compare: 'Compare',
  drill:   'Drill',
};

interface ModeToolbarProps {
  mode: HistoryMode;
  onModeChange: (m: HistoryMode) => void;
  activePerspectiveKeys: string[];
  onActivePerspectivesChange: (keys: string[]) => void;
  availablePerspectives: PerspectiveLens[];
}

export function ModeToolbar({
  mode,
  onModeChange,
  activePerspectiveKeys,
  onActivePerspectivesChange,
  availablePerspectives,
}: ModeToolbarProps) {

  const handleModeChange = (m: HistoryMode) => {
    onModeChange(m);
    // Clamp active perspectives to match new mode constraints
    if (m === 'causal' && activePerspectiveKeys.length > 1) {
      onActivePerspectivesChange(activePerspectiveKeys.slice(0, 1));
    } else if (m === 'compare' && activePerspectiveKeys.length > 2) {
      onActivePerspectivesChange(activePerspectiveKeys.slice(0, 2));
    }
  };

  const handleTogglePerspective = (key: string) => {
    const isActive = activePerspectiveKeys.includes(key);

    if (mode === 'causal') {
      // Exactly 1 — toggle replaces current selection
      if (isActive) {
        onActivePerspectivesChange([]);
      } else {
        onActivePerspectivesChange([key]);
      }
      return;
    }

    if (mode === 'compare') {
      // Exactly 2
      if (isActive) {
        onActivePerspectivesChange(activePerspectiveKeys.filter(k => k !== key));
      } else {
        const next = [...activePerspectiveKeys.filter(k => k !== key), key];
        onActivePerspectivesChange(next.slice(-2));
      }
      return;
    }

    // drill — any number
    if (isActive) {
      onActivePerspectivesChange(activePerspectiveKeys.filter(k => k !== key));
    } else {
      onActivePerspectivesChange([...activePerspectiveKeys, key]);
    }
  };

  return (
    <div className="flex items-center gap-2 shrink-0">
      {/* Mode buttons */}
      <div className="flex items-center border border-border rounded overflow-hidden">
        {(Object.keys(MODE_LABELS) as HistoryMode[]).map(m => (
          <button
            key={m}
            onClick={() => handleModeChange(m)}
            className={`px-2.5 py-1 text-[10px] font-mono transition-colors ${
              mode === m
                ? 'bg-accent/20 text-accent'
                : 'bg-transparent text-dim hover:text-fg'
            }`}
          >
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Perspective chips */}
      {availablePerspectives.length > 0 && (
        <div className="flex items-center gap-1 flex-wrap">
          {availablePerspectives.map(lens => {
            const isActive = activePerspectiveKeys.includes(lens.key);
            // Use biasColor if available, else fallback to accent
            const accentColor = lens.biasColor
              ? `border-[${lens.biasColor}] text-[${lens.biasColor}]`
              : 'border-accent/40 text-accent';

            return (
              <button
                key={lens.key}
                onClick={() => handleTogglePerspective(lens.key)}
                title={`${lens.axis}: ${lens.label}`}
                className={`px-2 py-0.5 rounded border text-[10px] font-mono transition-colors whitespace-nowrap ${
                  isActive
                    ? `bg-accent/10 border-accent/50 text-accent ${accentColor}`
                    : 'bg-transparent border-border text-dim hover:text-fg'
                }`}
              >
                {lens.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
