// M14 UI — shared Preact component library public surface.
//
// Everything importable from `src/ui/screens/**` and `src/app/**` lives here.
// Barrel discipline: `export { ... }` and `export type { ... }` per component,
// never `export *` — verbatimModuleSyntax rejects blanket re-exports of type
// declarations and this file is the D-IOC-SEAM's read side (screens/app read
// props types from here; they never reach into individual component files).
//
// Internal helpers (`./internal.ts`, `_cx`, `_clamp`) are deliberately NOT
// re-exported — they are not part of the public surface.

// ---- Primitives -----------------------------------------------------------
export {
  Panel,
  PanelHeader,
  Button,
  Field,
  Select,
  Segmented,
  Tabs,
  Checkbox,
  Chip,
  Meter,
  StatRow,
  Delta,
  deltaSign,
} from './primitives.js';
export type {
  PanelProps,
  PanelVariant,
  PanelHeaderProps,
  ButtonProps,
  ButtonSize,
  ButtonType,
  ButtonVariant,
  FieldProps,
  FieldType,
  SelectOption,
  SelectProps,
  SegmentedOption,
  SegmentedProps,
  TabsOption,
  TabsProps,
  CheckboxProps,
  ChipProps,
  ChipTone,
  MeterProps,
  MeterFill,
  StatRowProps,
  DeltaProps,
  DeltaSign,
} from './primitives.js';

// ---- Identity components (never-color-alone vocabulary) -------------------
export {
  FleetGlyph,
  FLEET_META,
  SlotTag,
  SLOT_LETTER,
  SlotPips,
  SLOT_ORDER,
  groupSlotPips,
  BodyStateTag,
} from './identity.js';
export type {
  FleetId,
  FleetGlyphProps,
  SlotTagProps,
  SlotPipsProps,
  SlotPipsGroup,
  BodyStateKind,
  BodyStateTagProps,
} from './identity.js';

// ---- Overlays & notices ---------------------------------------------------
export { Modal, Toast, Banner } from './overlays.js';
export type {
  ModalProps,
  ModalRole,
  ToastProps,
  ToastTone,
  BannerProps,
  BannerTone,
} from './overlays.js';

// ---- App chrome -----------------------------------------------------------
export { Topbar, DesktopGate, ErrorFallback } from './chrome.js';
export type {
  TopbarProps,
  TopbarRoute,
  DesktopGateProps,
  ErrorFallbackProps,
} from './chrome.js';

// ---- InfoTip primitive + glossary (playtest-feedback-01 · S06) ------------
// Stateless, CSS-revealed tooltip + the plain-language definitions the
// derived-stats panel shows the player. Screens import both from this barrel.
export { InfoTip } from './tooltip.js';
export type { InfoTipProps } from './tooltip.js';
export { GLOSSARY } from './glossary.js';
export type { GlossaryKey } from './glossary.js';
