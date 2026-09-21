# figma-make-app

React + Vite + Tailwind CSS project running inside Figma Make.

## Development Server

A Vite development server is **already running** on `$PORT` (default 8443). You don't need to start it manually.

- Preview URL: The user can access the running app through the preview panel
- Hot reload: Changes to source files are reflected immediately

## Project Structure

This is the canonical project structure. Start with task-relevant files below. Only follow imports or inspect other files when required, when a documented path is missing, or when the repository contradicts this guide.

- `src/main.tsx` - React entrypoint; imports `src/index.css` and mounts `src/App.tsx` into the `#root` element
- `src/App.tsx` - Primary application component and the usual starting point for UI work
- `src/index.css` - Global CSS entrypoint and Tailwind CSS v4 import
- `index.html` - Vite HTML shell containing the `#root` element and loading `src/main.tsx`
- `package.json` - Project dependencies and the Vite build, development, preview, and formatting scripts
- `vite.config.ts` - Vite configuration with React, Tailwind CSS v4, and Figma Make plugins plus the `@` alias for `src`
- `.mise.toml` - Toolchain versions for Node.js and pnpm

## Dependencies

- Runtime: React 19 and React DOM 19
- Styling: Tailwind CSS v4 with the `@tailwindcss/vite` plugin
- Build tooling: Vite 8, TypeScript 5.7, and `@vitejs/plugin-react`
- Formatting: oxfmt

## Styling

This project uses **Tailwind CSS v4** through the `@tailwindcss/vite` plugin configured in `vite.config.ts`. `src/index.css` imports Tailwind with `@import 'tailwindcss';`. Use Tailwind utility classes directly in JSX and put global CSS or Tailwind v4 theme customization in `src/index.css`. This scaffold does not need a Tailwind config file or PostCSS config.

`src/main.tsx` imports `src/index.css`, so global font wiring belongs in `src/index.css`. Keep CSS `@import` statements first, then add any `@font-face` rules and font-family defaults there.

## Spin & Wheel betting platform (added)

The app is a physical-shop betting platform, not just a Vite front end. See `README.md`.

- The frontend needs a backend: run `pnpm dev:server` (Node, port 8787: API, WebSocket, game engine, SQLite in `data/`). Vite proxies `/api` and `/ws` to it (`vite.config.ts`).
- Routes: `/` (customer game screen, public, always the first page), `/cashier` and `/admin` (each shows its own sign-in until authenticated; there is no `/login`). Code: `server/` and `src/pages/{Display,StaffLogin}.tsx`, `src/pages/pos/`, `src/pages/admin/`.
- Two games run side by side: the wheel and the dog race (`GameType` = `WHEEL` | `DOGS`). Dog race code lives in `dog race/` (shared rules, race draw, UI) and hooks into `server/game.ts` / `server/tickets.ts`; its rounds use ids from 1,000,000,001 and display as `D00001` (`gameNo` in `src/lib/format.ts`). The WebSocket state carries both games under `games`. `dog race/reference/` is third-party material for reference only: never import or ship it.
- Money is integer santim (1 ETB = 100) and odds are integer hundredths everywhere. Never use floats for money. Money only moves through `server/ledger.ts` `postTxn`, inside `tx()`.
- Verify with `pnpm test` and `pnpm typecheck`. Server code must stay Node-native-TypeScript compatible (`import type`, no enums/parameter properties; `.ts` import extensions).
- `legacy/` holds the original roulette demo that `src/App.tsx` used to contain.
