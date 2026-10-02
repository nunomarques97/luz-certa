# Luz Certa web app

Angular single-page app. Parsing and calculation code lives in `src/app/engine/` (pure TypeScript, no DOM, Web Worker ready).

Requires Node.js 22.18 or later (the fixture generator runs TypeScript directly).

| Command | What it does |
| --- | --- |
| `npm install` | Install dependencies |
| `npm start` | Dev server on http://localhost:4500 |
| `npm run build` | Production build into `dist/` |
| `npm test` | Engine type check without DOM types, then Vitest unit tests (single run) |
| `npm run fixtures` | Regenerate the synthetic files in `../fixtures/synthetic/` (deterministic) |
| `npm run e2e` | Playwright tests against a dev server on port 4510 |

The E-Redes file format is described in [../docs/E-REDES-FORMAT.md](../docs/E-REDES-FORMAT.md).
