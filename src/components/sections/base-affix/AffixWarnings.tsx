import type { ValidationWarning } from '../../../utils/affix-validation';

interface AffixWarningsProps {
  warnings: readonly ValidationWarning[];
  /** Called when the user clicks a warning's "Remove" action button.
   *  Receives the list of indices the warning identified as affected so
   *  the parent can filter them out of selectedAffixes. */
  onRemoveIndices: (indices: readonly number[]) => void;
}

/**
 * Presentational block that renders the output of
 * `validateSelectedAffixes`. Returns `null` when there are no warnings so
 * the containing section doesn't show an empty box.
 *
 * Accessibility:
 *   - The whole block is `role="status"` with `aria-live="polite"` so a
 *     screen reader is notified when warnings appear, without interrupting
 *     whatever the user is doing.
 *   - Each warning's icon is `aria-hidden` — the title and message already
 *     carry the meaning.
 *   - Severity is communicated by icon + left-border + token color, not by
 *     color alone (WCAG `color-not-only`).
 *
 * Severity color mapping (matches the amber/gray/red palette used
 * throughout the builder):
 *   - `info`    → sky (neutral information)
 *   - `warning` → amber (user attention, not blocking)
 */
export function AffixWarnings({ warnings, onRemoveIndices }: AffixWarningsProps) {
  if (warnings.length === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="mb-4 rounded-lg border border-gray-700 bg-gray-800/80 p-4 space-y-3"
    >
      {warnings.map((w) => (
        <WarningItem key={w.id} warning={w} onRemoveIndices={onRemoveIndices} />
      ))}
    </div>
  );
}

interface WarningItemProps {
  warning: ValidationWarning;
  onRemoveIndices: (indices: readonly number[]) => void;
}

function WarningItem({ warning, onRemoveIndices }: WarningItemProps) {
  const palette =
    warning.severity === 'warning'
      ? {
          // amber-200 on gray-800 ≈ 8:1 contrast (WCAG AAA)
          border: 'border-amber-500/60',
          icon: 'text-amber-400',
          title: 'text-amber-200',
          body: 'text-amber-100/90',
        }
      : {
          // sky-200 on gray-800 ≈ 8:1 contrast (WCAG AAA)
          border: 'border-sky-500/60',
          icon: 'text-sky-400',
          title: 'text-sky-200',
          body: 'text-sky-100/90',
        };

  return (
    <div className={`flex gap-3 border-l-2 ${palette.border} pl-3`}>
      <Icon kind={warning.severity} className={`mt-0.5 h-4 w-4 flex-shrink-0 ${palette.icon}`} />
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${palette.title}`}>{warning.title}</p>
        <p className={`mt-1 text-xs leading-relaxed ${palette.body}`}>{warning.message}</p>
        {warning.action !== undefined && (
          <button
            type="button"
            onClick={() => onRemoveIndices(warning.affectedIndices)}
            className="mt-2 inline-flex items-center rounded border border-gray-600 bg-gray-700 px-2 py-1 text-xs font-medium text-gray-100 hover:bg-gray-600 cursor-pointer"
          >
            {warning.action.label}
          </button>
        )}
      </div>
    </div>
  );
}

interface IconProps {
  kind: 'info' | 'warning';
  className?: string;
}

/**
 * Inline SVG icons rather than an external dependency. Both are 24×24
 * viewport, stroke-based (1.5px) to stay consistent with the overall UI
 * aesthetic. `aria-hidden` because the severity is also communicated by
 * the title text — the icon is a redundant visual cue.
 */
function Icon({ kind, className = '' }: IconProps) {
  if (kind === 'warning') {
    return (
      <svg
        aria-hidden="true"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={className}
      >
        <path d="M12 9v4" />
        <path d="M12 17h.01" />
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
      </svg>
    );
  }
  // info icon
  return (
    <svg
      aria-hidden="true"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}
