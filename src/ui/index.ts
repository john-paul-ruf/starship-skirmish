// M14 UI — public surface (S03).
//
// The IoC seam (D-IOC-SEAM) exposes the App shell + the service contract
// screens consume. `src/app/boot.tsx` imports `App` from here; screens import
// `useApp` / `AppServices` / `Route` from `./appContext.js`.
//
// The shared component library keeps its own barrel (`./components/index.js`)
// — verbatimModuleSyntax + explicit `export type` there means a blanket
// re-export from here would double-declare the type surface. Consumers import
// components from `src/ui/components/index.js` directly, matching the
// existing test suite's convention.

export { App } from './App.js';
export {
  AppContext,
  useApp,
  type AppServices,
  type Route,
  type ToastKind,
  type ToastItem,
} from './appContext.js';
export {
  MatchProvider,
  useMatch,
  type BotSpec,
  type MatchController,
  type MatchPhase,
} from './matchContext.js';
