// M14 UI — shared presentational primitives (S02 checkpoint 1).
//
// Every component here is:
//   - stateless and side-effect-free (hooks are deliberately absent — the
//     library is testable in vitest's node env by direct function invocation)
//   - app-agnostic (props/callbacks only; no `src/app/**` imports — the D-IOC-
//     SEAM rule in the feature STATE.md; see also eslint `APP_IMPORT_PATTERN`)
//   - mapped to a class-name string that lives in `src/ui/styles/**` (S01);
//     never `import`s a stylesheet — S03 imports S01's barrel once at the root.
//
// All class-name strings match `mocks/console.css` verbatim — that file is the
// source of truth per `specs/design.md` §2 and the token layer S01 preserves.

import type { ComponentChildren, JSX, VNode } from 'preact';

import { clamp, cx } from './internal.js';

// ---- Panel (design §2 · .panel / .panel-in / .ticks) ----------------------

export type PanelVariant = 'default' | 'inset';

export interface PanelProps {
  /** `default` → `.panel`; `inset` → `.panel-in` (list rows, inset wells). */
  readonly variant?: PanelVariant;
  /** Adds the `.ticks` corner-tick decoration. Use sparingly (design §1.5). */
  readonly ticks?: boolean;
  readonly role?: JSX.HTMLAttributes<HTMLDivElement>['role'];
  readonly id?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly class?: string;
  readonly children?: ComponentChildren;
}

export function Panel(props: PanelProps): VNode {
  const {
    variant = 'default',
    ticks = false,
    role,
    id,
    class: extra,
    children,
  } = props;
  return (
    <div
      class={cx(variant === 'inset' ? 'panel-in' : 'panel', ticks && 'ticks', extra)}
      role={role}
      id={id}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
    >
      {children}
    </div>
  );
}

// ---- PanelHeader (design §2 · .panel-hd) ----------------------------------

export interface PanelHeaderProps {
  /** If provided, rendered as a `.t-h2` span before `children`. */
  readonly title?: string;
  readonly titleId?: string;
  readonly class?: string;
  readonly children?: ComponentChildren;
}

export function PanelHeader(props: PanelHeaderProps): VNode {
  const { title, titleId, class: extra, children } = props;
  return (
    <div class={cx('panel-hd', extra)}>
      {title !== undefined && (
        <span class="t-h2" id={titleId}>
          {title}
        </span>
      )}
      {children}
    </div>
  );
}

// ---- Button (design §2 · .btn / .btn-primary / danger / warn / ghost) -----

export type ButtonVariant = 'default' | 'primary' | 'danger' | 'warn' | 'ghost';
export type ButtonSize = 'sm' | 'md';
export type ButtonType = 'button' | 'submit' | 'reset';

const BUTTON_VARIANT_CLASS: Record<ButtonVariant, string | false> = {
  default: false,
  primary: 'btn-primary',
  danger: 'btn-danger',
  warn: 'btn-warn',
  ghost: 'btn-ghost',
};

export interface ButtonProps {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly type?: ButtonType;
  readonly disabled?: boolean;
  readonly onClick?: JSX.MouseEventHandler<HTMLButtonElement>;
  readonly title?: string;
  readonly id?: string;
  readonly name?: string;
  readonly value?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-pressed'?: boolean;
  readonly 'aria-current'?: 'page' | boolean;
  readonly 'aria-expanded'?: boolean;
  readonly 'aria-controls'?: string;
  readonly class?: string;
  readonly children?: ComponentChildren;
}

export function Button(props: ButtonProps): VNode {
  const {
    variant = 'default',
    size = 'md',
    type = 'button',
    disabled = false,
    onClick,
    title,
    id,
    name,
    value,
    class: extra,
    children,
  } = props;
  return (
    <button
      type={type}
      id={id}
      name={name}
      value={value}
      class={cx('btn', BUTTON_VARIANT_CLASS[variant], size === 'sm' && 'btn-sm', extra)}
      disabled={disabled || undefined}
      onClick={onClick}
      title={title}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      aria-pressed={props['aria-pressed']}
      aria-current={props['aria-current']}
      aria-expanded={props['aria-expanded']}
      aria-controls={props['aria-controls']}
    >
      {children}
    </button>
  );
}

// ---- Field (design §2 · .field text input) --------------------------------

export type FieldType = 'text' | 'search' | 'password' | 'email' | 'number' | 'url' | 'tel';

export interface FieldProps {
  readonly value?: string;
  readonly onInput?: JSX.GenericEventHandler<HTMLInputElement>;
  readonly onChange?: JSX.GenericEventHandler<HTMLInputElement>;
  readonly onKeyDown?: JSX.KeyboardEventHandler<HTMLInputElement>;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly readOnly?: boolean;
  readonly type?: FieldType;
  readonly id?: string;
  readonly name?: string;
  readonly autoComplete?: string;
  readonly spellcheck?: boolean;
  readonly maxLength?: number;
  readonly inputMode?: JSX.HTMLAttributes<HTMLInputElement>['inputMode'];
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: boolean;
  readonly class?: string;
}

export function Field(props: FieldProps): VNode {
  const {
    value,
    onInput,
    onChange,
    onKeyDown,
    placeholder,
    disabled = false,
    readOnly = false,
    type = 'text',
    id,
    name,
    autoComplete,
    spellcheck,
    maxLength,
    inputMode,
    class: extra,
  } = props;
  return (
    <input
      type={type}
      class={cx('field', extra)}
      value={value}
      onInput={onInput}
      onChange={onChange}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled || undefined}
      readOnly={readOnly || undefined}
      id={id}
      name={name}
      autocomplete={autoComplete}
      spellcheck={spellcheck}
      maxLength={maxLength}
      inputMode={inputMode}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
      aria-invalid={props['aria-invalid']}
    />
  );
}

// ---- Select (design §2 · select.field dropdown) ---------------------------

export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SelectProps {
  readonly value?: string;
  readonly options: readonly SelectOption[];
  readonly onChange?: JSX.GenericEventHandler<HTMLSelectElement>;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly class?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
}

export function Select(props: SelectProps): VNode {
  const {
    value,
    options,
    onChange,
    disabled = false,
    id,
    name,
    class: extra,
  } = props;
  return (
    <select
      class={cx('field', extra)}
      value={value}
      onChange={onChange}
      disabled={disabled || undefined}
      id={id}
      name={name}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} disabled={o.disabled || undefined}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

// ---- Segmented (design §2 · .seg exclusive-choice bar) --------------------

export interface SegmentedOption<V extends string = string> {
  readonly value: V;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface SegmentedProps<V extends string = string> {
  readonly options: readonly SegmentedOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  /** REQUIRED — the group needs an accessible name (WCAG). */
  readonly 'aria-label': string;
  readonly class?: string;
}

export function Segmented<V extends string = string>(props: SegmentedProps<V>): VNode {
  const { options, value, onChange, class: extra } = props;
  return (
    <div class={cx('seg', extra)} role="group" aria-label={props['aria-label']}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled || undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---- Tabs (design §2 · .tabs / .tab section switch) -----------------------

export interface TabsOption<Id extends string = string> {
  readonly id: Id;
  readonly label: string;
  readonly disabled?: boolean;
}

export interface TabsProps<Id extends string = string> {
  readonly tabs: readonly TabsOption<Id>[];
  readonly activeId: Id;
  readonly onChange: (id: Id) => void;
  /** REQUIRED — the tablist needs an accessible name. */
  readonly 'aria-label': string;
  readonly class?: string;
}

export function Tabs<Id extends string = string>(props: TabsProps<Id>): VNode {
  const { tabs, activeId, onChange, class: extra } = props;
  return (
    <div class={cx('tabs', extra)} role="tablist" aria-label={props['aria-label']}>
      {tabs.map((t) => {
        const active = t.id === activeId;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled || undefined}
            class={cx('tab', active && 'is-active')}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ---- Checkbox (design §2 · .chk multi-select) -----------------------------

export interface CheckboxProps {
  readonly checked?: boolean;
  readonly onChange?: JSX.GenericEventHandler<HTMLInputElement>;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly name?: string;
  readonly value?: string;
  readonly 'aria-label'?: string;
  readonly 'aria-labelledby'?: string;
  readonly 'aria-describedby'?: string;
  readonly class?: string;
}

export function Checkbox(props: CheckboxProps): VNode {
  const { checked, onChange, disabled = false, id, name, value, class: extra } = props;
  return (
    <input
      type="checkbox"
      class={cx('chk', extra)}
      checked={checked}
      onChange={onChange}
      disabled={disabled || undefined}
      id={id}
      name={name}
      value={value}
      aria-label={props['aria-label']}
      aria-labelledby={props['aria-labelledby']}
      aria-describedby={props['aria-describedby']}
    />
  );
}

// ---- Chip (design §2 · .chip tag / status / version) ----------------------

export type ChipTone = 'neutral' | 'cyan' | 'amber' | 'red' | 'green';

const CHIP_TONE_CLASS: Record<ChipTone, string | false> = {
  neutral: false,
  cyan: 'chip-cyan',
  amber: 'chip-amber',
  red: 'chip-red',
  green: 'chip-green',
};

export interface ChipProps {
  readonly tone?: ChipTone;
  readonly title?: string;
  readonly class?: string;
  readonly children?: ComponentChildren;
}

export function Chip(props: ChipProps): VNode {
  const { tone = 'neutral', title, class: extra, children } = props;
  return (
    <span class={cx('chip', CHIP_TONE_CLASS[tone], extra)} title={title}>
      {children}
    </span>
  );
}

// ---- Meter (design §2 · .meter bar with optional notches) -----------------

export type MeterFill = 'shield' | 'hull' | 'dv' | 'ok' | 'hot';

export interface MeterProps {
  /** Displayed value. Clamped to `0..max`; NaN → 0. */
  readonly value: number;
  /** Maximum. `≤ 0` renders an empty bar (avoids divide-by-zero). */
  readonly max: number;
  /** Fill palette. `ok` (green) is the default. */
  readonly fill?: MeterFill;
  /** Notch positions in the same units as `value` (e.g. a 80% threshold at `max*0.8`). */
  readonly notches?: readonly number[];
  /** Reduces the bar height to `.meter-sm` for inline usage. */
  readonly compact?: boolean;
  readonly class?: string;
  /**
   * The meter itself carries no text — supply an aria label whenever the meter
   * is the sole channel for the fact it displays. Callers that pair the meter
   * with a labelled `.stat` may omit it (design §1.1 never-color-alone).
   */
  readonly 'aria-label'?: string;
}

export function Meter(props: MeterProps): VNode {
  const { value, max, fill = 'ok', notches, compact = false, class: extra } = props;
  const safeMax = max > 0 ? max : 0;
  const safeValue = safeMax === 0 ? 0 : clamp(value, 0, safeMax);
  const pct = safeMax === 0 ? 0 : (safeValue / safeMax) * 100;
  return (
    <div
      class={cx('meter', compact && 'meter-sm', extra)}
      role={props['aria-label'] !== undefined ? 'img' : undefined}
      aria-label={props['aria-label']}
    >
      <span class={cx('meter-fill', `f-${fill}`)} style={`width: ${pct}%`} />
      {notches?.map((n, idx) => {
        const clamped = safeMax === 0 ? 0 : (clamp(n, 0, safeMax) / safeMax) * 100;
        return <span key={idx} class="meter-notch" style={`left: ${clamped}%`} />;
      })}
    </div>
  );
}

// ---- StatRow (design §2 · .stat key/value readout) ------------------------

export interface StatRowProps {
  readonly label: string;
  readonly value: ComponentChildren;
  readonly class?: string;
}

export function StatRow(props: StatRowProps): VNode {
  const { label, value, class: extra } = props;
  return (
    <div class={cx('stat', extra)}>
      <span class="stat-k">{label}</span>
      <span class="stat-v">{value}</span>
    </div>
  );
}

// ---- Delta (design §2 · .delta signed change indicator) -------------------

export type DeltaSign = 'up' | 'down' | 'none';

/** The class-name suffix chosen for a raw signed diff. Exported for tests. */
export function deltaSign(diff: number): DeltaSign {
  if (Number.isNaN(diff) || diff === 0) return 'none';
  return diff > 0 ? 'up' : 'down';
}

export interface DeltaProps {
  /** Pre-change value. */
  readonly from: number;
  /** Post-change value. */
  readonly to: number;
  /** Trailing unit (e.g. `' pt'`, `'/T'`). Empty by default. */
  readonly unit?: string;
  /** Decimal digits for the magnitude. Default `0`. */
  readonly precision?: number;
  readonly title?: string;
  readonly class?: string;
}

/**
 * FR-6: change vs. previous value, ALWAYS carrying an arrow and an explicit
 * sign — never the color alone (design §1.1). `▲` up / `▼` down / `—` none;
 * text follows as `+N` / `−N` / `0`. Uses the U+2212 minus so the sign lines
 * up under a tabular-nums stat column.
 */
export function Delta(props: DeltaProps): VNode {
  const { from, to, unit = '', precision = 0, title, class: extra } = props;
  const diff = to - from;
  const sign = deltaSign(diff);
  const magnitude = Math.abs(diff).toFixed(precision);
  let text: string;
  if (sign === 'up') text = `▲ +${magnitude}${unit}`;
  else if (sign === 'down') text = `▼ −${magnitude}${unit}`;
  else text = `— 0${unit}`;
  return (
    <span class={cx('delta', `delta-${sign}`, extra)} title={title}>
      {text}
    </span>
  );
}
