# Philani Academy — No-Scroll UI Blueprint

## 1. Objective
Craft a site-wide interaction model where every major task gets a full-screen, distraction-free stage. Instead of long scrolling dashboards, we guide users through focused "cards as pages" so canvas work, JaaS tutoring, billing, and admin chores each receive their own uninterrupted space.

---

## 2. Core Design Pillars
1. **Screen-per-task** – each major function (live class, board, announcements, sessions, billing, etc.) occupies a dedicated route. No vertical scroll within these stages; overflow appears in contextual trays or paginated stacks.
2. **Stage + Utility Rail** – every screen consists of a primary stage (≈80% width on desktop, full width on tablets) plus a collapsible rail for secondary info (participants, quick stats, chat, actions). Rails slide over the stage instead of forcing the page to grow vertically.
3. **Commandable navigation** – persistent top app-bar with: grade selector, dynamic breadcrumbs, quick actions, and an always-visible "Switch view" launcher. Nav arrows (existing component) become first-class to move between sibling views.
4. **Consistent rhythm** – align all typography, spacing, and button placements to an 8px grid. Key CTAs live on the right edge of the top bar; destructive or global toggles sit in the utility rail.
5. **Responsive without scroll** – on mobile/tablet, each stage becomes a swipeable carousel of sub-panels (e.g., video feed, chat, whiteboard). Orientation-sensitive components (canvas) auto-scale while preserving a minimum interactive area of 320×480.

---

## 3. Shell & Layout System
- **AppShell** (new shared layout):
  - Top bar: logo, page title, grade pill, active status indicator, user menu.
  - Stage container: `height: calc(100vh - topBar)`; uses CSS grid to switch between templates:
    - `FocusStage`: single pane (e.g., Sign-in, Subscribe, Verify-Email).
    - `SplitStage`: 2-column stage + rail (Live Class, Canvas, Announcements composer).
    - `DeckStage`: horizontal pager for multi-step flows (Sessions, Learners, Billing management).
  - Bottom navigation (mobile): icons for "Class", "Board", "Feed", "Admin".
- **Modal strategy**: large editors (e.g., new announcement, session builder) open as full-screen overlays rather than inline form stacks.
- **State chips**: show unsaved changes, syncing, live status within the top bar to avoid inline banners.

---

## 4. Page-by-Page Plan
### 4.1 Hub (`/dashboard`)
- Purpose: routing + quick pulse.
- Layout: FocusStage with four full-width tiles (Grade Overview, Next Lesson, Quick Actions, Alerts). Each tile is a doorway (enters `/live`, `/board`, `/feed`, `/sessions`).
- No data tables; keep summary metrics + CTA buttons. The hub never scrolls.

### 4.2 Live Class (`/live`)
- Derived from current Jitsi embed.
- Stage: JaaS window (full height) with layered controls.
- Rail: participant list, attendance toggles, "Share board" button.
- Secondary screens: Screenshare, Chat, Breakouts -> slide-in drawers.

### 4.3 Board (`/board`)
- Hosts `MyScriptMathCanvas` in landscape by default; students can toggle orientation locally.
- Rail: page navigation, LaTeX projector controls, "Share page" status.
- Teacher-specific fullscreen toggle anchored in top bar. Students see orientation picker.

### 4.4 Announcements Feed (`/feed`)
- Stage: two cards side-by-side on desktop—Composer (left) and Grade Feed (right). On mobile, they become horizontal slides.
- Each announcement expands into a modal for details/downloads; no list scrolling—use pagination arrows + keyboard shortcuts.

### 4.5 Sessions Planner (`/sessions`)
- DeckStage with three panels: Schedule (calendar grid), Materials (session-specific files), Attendance (summary).
- Move between panels with nav arrows or hotkeys. Each panel fills the stage; details open as modals.

### 4.6 Learners (`/learners` for admins)
- SplitStage: roster table (left) capped to viewport height with virtual scroll inside the component, not the page; profile drawer (right) reveals when selecting a user.
- Bulk actions appear in the top bar dropdown.

### 4.7 Billing (`/billing`)
- Two-pane wizard: Plan catalog and Active subscription details.
- Payment forms open as embedded sheets (stripe checkout still via redirect but the UI communicates status without scrolling).

### 4.8 Profile (`/profile`)
- FocusStage with stacked cards managed via tabbed nav within the stage (Account, Contact, Security). Tabs swap entire card area, keeping page static.

### 4.9 Auth (`/auth/signin`, `/signup`, `/verify-email`)
- Full-height hero with split background. Forms stay centered; progress/status uses inline toasts anchored in fixed positions.

### 4.10 Subscribe (`/subscribe`)
- Carousel of plan cards (one per view). Use left/right nav to switch; CTA always fixed at bottom-right.

### 4.11 JaaS Demo (`/jaas-demo`)
- Mirrors Live Class layout but retains warning banner so testers know it’s a sandbox.

### 4.12 System pages (Privacy, Debug tools)
- Still full-height but scroll can be allowed for legal text inside an internal scroll container while the page remains fixed.

---

## 5. Navigation & Flow Strategy
1. **Global switcher** – transform NavBar into a segmented control: Hub, Live, Board, Feed, Sessions, Admin. Each emits a `router.push` without intermediate pages.
2. **NavArrows upgrade** – existing component becomes context-aware, showing previous/next sibling page names; keyboard shortcuts (←/→) replicate the action.
3. **Command palette** – `Ctrl/Cmd + K` opens quick actions ("Go to Board", "Share current page", "Create announcement") for power users, avoiding hidden UI.
4. **Grade awareness** – grade dropdown anchored in top bar; when changed, confirm if the user wants to re-contextualize across all pages (since each page is grade-scoped now).
5. **Status lights** – consistent indicators (Connected, Live, Paused) near the top-right so instructors aren’t hunting for connection states.

---

## 6. Interaction Rules
- **Zero vertical scroll**: `body` remains `overflow: hidden`. Each page manages overflow locally via carousels or trays.
- **Transitions**: use 200–250 ms slide animations between pages to reinforce spatial metaphor.
- **Breakpoints**:
  - ≥1200px: Stage + Rail (grid).
  - 768–1199px: Stage stack with collapsible rail.
  - <768px: Stage becomes a carousel; nav dock anchors at bottom.
- **Accessibility**: trap focus inside modals, ensure keyboard access to carousels (Arrow keys + focus outline). Provide ARIA labels for nav arrows (
  "Next panel" etc.).

---

## 7. Implementation Roadmap
1. **Shared layout component** – create `components/AppShell.tsx` with props for stage template, title, nav config.
2. **Route split** – extract each dashboard section into its own Next page (reuse existing logic but scoped).
3. **State lifting** – centralize grade selection, session context, and realtime status in a context provider so the top bar stays accurate everywhere.
4. **Component refactors** – convert long forms/tables into modal workflows or carousels.
5. **Progressive rollout** – enable feature flag (e.g., `NEXT_PUBLIC_NO_SCROLL_UI=1`) to test new layout before fully switching.

---

## 8. Next Steps
- Wireframe each screen (Figma or similar) using this blueprint.
- Build the shared `AppShell` and migrate `/board` + `/live` first (highest impact on focus).
- Move the remaining dashboard sections into standalone routes.
- Iterate with instructors/students for feedback, then finalize the theme and microcopy.
