# ClubOperationsPOS → the-clubs Migration Design

> Brainstormed 2026-02-19. All decisions approved by user.

---

## Decisions Summary

| Decision | Choice |
|----------|--------|
| Employee Register layout | Top application navbar (Preline) |
| Office Dashboard layout | Permanent static sidebar (Preline) |
| Customer Kiosk layout | No menu — full-screen flow |
| Visual theme | Dark tech: near-black + electric blue/cyan accents |
| Sign-in screen | Shared `LockScreen` component across both apps |
| State management | Zustand (feature-domain stores) |
| API + DB | Copy `services/api` and `db/` into the new monorepo |

---

## Architecture

### App Structures (Simplified)

Each app follows a flat 3-layer pattern (down from 7 layers in the original):

```
App.tsx → ErrorBoundary → AuthGate → {App Layout + Content}
```

#### employee-register
```
App.tsx
 └─ ErrorBoundary
     └─ AuthGate (shows LockScreen if unauthenticated)
         └─ TopNavbar (Preline Application Navbar)
             ├─ 10 nav items as tabs/dropdowns
             ├─ Session info + Sign Out
             └─ {activePanel}
```

#### office-dashboard
```
App.tsx
 └─ ErrorBoundary
     └─ AuthGate (shows LockScreen if unauthenticated)
         └─ SidebarLayout (Preline static sidebar)
             ├─ Sidebar: 11 nav items, role-based (admin vs staff)
             ├─ Header bar
             └─ <Routes> → {view components}
```

#### customer-kiosk
```
App.tsx
 └─ ErrorBoundary
     └─ KioskController
         └─ {screen by flow state}
             idle → selection → agreement → payment → complete
```

### Shared LockScreen

Single `LockScreen` component in `packages/ui`:
- Split-screen: login form (left) + branding panel (right)
- Two auth modes: WebAuthn (fingerprint) + PIN (6-digit)
- Dark tech theme with brand logo
- Accepts `appTitle` prop to differentiate ("Employee Register" vs "Office Dashboard")

### State Management — Zustand

Replace 25+ React Context hooks with ~6 Zustand stores:

| Store | Replaces | Used By |
|-------|----------|---------|
| `useAuthStore` | AuthGateContext, session state | All apps |
| `useScanStore` | useScanState, useScanFormState, useScanResolutionState | Employee Register |
| `useCustomerStore` | useCustomerSearchState, useCustomerNotesState, useCustomerDocumentsState, useCustomerSessionActions | Employee Register |
| `useInventoryStore` | useInventorySelectionState, useRenewalSelectionState, useMembershipPromptState | Employee Register |
| `useCheckoutStore` | useCheckoutState, usePaymentActions, usePastDueState | Employee Register |
| `useRealtimeStore` | useRegisterRealtimeState, usePollingFallback, useHealthStatus | Employee Register |

No providers needed. Components subscribe directly.

---

## Visual Design — Dark Tech

### Color Tokens
- **Background:** `#0a0a0f` (near-black with blue undertone)
- **Surface:** `#12121a` (card/panel backgrounds)
- **Border:** `#1e1e2e` (subtle separation)
- **Primary accent:** `#00d4ff` (electric cyan)
- **Secondary accent:** `#3b82f6` (blue)
- **Success:** `#10b981`
- **Warning:** `#f59e0b`
- **Error:** `#ef4444`
- **Text primary:** `#e2e8f0`
- **Text muted:** `#64748b`

### Typography
Distinctive font pairing (not Inter/Roboto per `frontend-design` skill):
- **Display/headings:** JetBrains Mono or similar monospace-inspired display font
- **Body/UI:** Plus Jakarta Sans or equivalent geometric sans

### Component Mapping (TailAdmin → Preline)

| Original | New (Preline) |
|----------|---------------|
| TailAdmin Alert | `hs-alert` |
| TailAdmin Badge | Preline Badge |
| TailAdmin Button | Preline Button |
| TailAdmin Card | Preline Card |
| TailAdmin Modal | `hs-overlay` |
| TailAdmin Spinner | Preline Spinner |
| TailAdmin Table | Preline Table |
| TailAdmin Dropdown | `hs-dropdown` |
| Custom SlideOutDrawer | `hs-overlay` (offcanvas mode) |
| Custom PinInput | Keep, restyle to dark tech |

---

## What Gets Copied

### Direct Copy (logic unchanged)
- `services/api/` — entire Fastify API service
- `db/schema.sql` — PostgreSQL schema
- `packages/shared/src/` — all 16 files (types, schemas, helpers)

### Copy + Restyle (logic stays, UI rebuilt with Preline)
- LockScreen auth logic
- All 10 employee-register panels (scan, search, inventory, upgrades, retail, checkout, account, club log, manual entry, room cleaning)
- All 11 office-dashboard views
- All customer-kiosk flow screens
- WebAuthn client library
- PinInput + Numpad components

### Drop (not needed)
- `packages/app-kit/` — no source, not needed
- TailAdmin UI primitives — replaced by Preline
- Excessive wrapper layers (CheckInPage, AppRoot, AppProviders, SessionRoot, ModalsRoot, PaymentRoot, NotificationsRoot)
- AuthGateContext — replaced by `useAuthStore` (Zustand)

---

## Implementation Order

1. **Foundation** — Copy `services/api`, `db/`, `packages/shared`. Add Zustand. Set up Tailwind theme tokens.
2. **Shared UI** — Build `LockScreen`, `PinInput`, error boundary in `packages/ui` with Preline + dark tech theme.
3. **Employee Register** — Top navbar layout → 10 panels (start with Scan, then others).
4. **Office Dashboard** — Static sidebar layout → 11 views (start with Overview, then others).
5. **Customer Kiosk** — Flow screens (idle → selection → agreement → payment → complete).
6. **Polish** — Animations, micro-interactions, final Preline JS integration.
