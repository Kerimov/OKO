# Portal CSS layout

Load order (`src/main.tsx`):

1. `index.css` — global resets + `.app` flex shell only
2. Page/feature sheets (legacy rules moved out of `index.css`):
   - `pages-home.css`, `pages-tables.css`, `pages-auth-settings.css`, `pages-my-forms.css`
   - `admin-checks.css`, `tools.css`
   - `bp-monitor.css`, `instructions.css`, `rash-constructor.css`, `refs-admin.css`, `desktop.css`
3. `design-system.css` — imports `tokens.css`, buttons, tables, sidebar polish
4. `shell.css` — app chrome layout + atmosphere
5. `data-display.css` — tables, filters, control tweaks
6. `screens.css` — package workspace / form screen composition

Later sheets override earlier ones (same as when page rules lived in `index.css` before the design pass).

**Tokens:** only in `styles/tokens.css`. Do not reintroduce a second `:root` token block in `index.css`.

**New styles:** add under `styles/` (prefer an existing sheet or a focused new file). Do not grow `index.css` beyond resets.

**Dedupe:** if a selector already exists in `design-system` / `shell` / `data-display` / `screens`, extend that core rule instead of copying it into a page sheet. Page sheets should keep only screen-unique rules.
