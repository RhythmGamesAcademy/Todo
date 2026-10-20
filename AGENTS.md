# Repository Guidelines

## Project Structure & Module Organization

This is a React 19, TypeScript, Vite, and Tailwind CSS TODO application. `src/App.tsx` coordinates screens; `src/ui.tsx` contains shared UI; `src/model.ts` handles domain rules and serialization; `src/storage.ts` manages localStorage. Backup and restore controls live in `src/DataPanel.tsx`. Keep completion animation logic in `src/completion/` and navigation in `src/components/`.

Tests sit beside their modules as `*.test.ts` or `*.test.tsx`. Static assets belong in `public/`. `dist/` is generated, and `artifacts/` is ignored scratch space. GitHub Pages deployment is configured in `.github/workflows/pages.yml`.

## Build, Test, and Development Commands

Use Node.js 24, matching CI, and install dependencies with `npm ci`.

- `npm run dev`: start the local Vite server.
- `npm test`: run the Vitest suite once.
- `npm run build`: run TypeScript checks and generate `dist/`.
- `npm run preview`: serve the production build locally.
- `npm run format`: format source and listed configuration files with Prettier.

For focused formatting, use `npx prettier --write src/completion/SeaLion.tsx`. If the bundled Vite config loader encounters a local permission error, try `npm run build -- --configLoader runner`.

## Coding Style & Naming Conventions

Follow Prettier: two-space indentation, double quotes, and semicolons. Use strict TypeScript, explicit domain types, and `import type` for type-only imports. Name components in PascalCase and hooks as `useSomething`.

Separate responsibilities instead of expanding large components. Centralize Japanese UI text, accessibility labels, notifications, and date formatting in `src/messages.ts`. Derive animation destinations from rendered DOM measurements rather than fixed screen coordinates.

## Testing Guidelines

Use Vitest and React Testing Library; UI tests declare `// @vitest-environment jsdom`. Follow existing descriptive Japanese test names. No numerical coverage threshold is configured. Cover changed behavior, especially persistence failures, restore merging, input preservation, and animation cancellation. Run tests and the production build before submitting. Check visual changes at desktop and mobile widths.

## Commit & Pull Request Guidelines

History uses concise Japanese summaries, such as `ビルドエラーを修正`; no Conventional Commits convention is established. Keep commits focused. PRs should describe the resulting behavior, link relevant issues, report validation, and include screenshots or recordings for UI changes.

## Data & Deployment

Preserve existing data when localStorage writes or validation fail. Keep backup formats compatible and validate imported JSON. Preserve Vite's relative `base` for repository-subpath hosting. Pushing to `main` triggers deployment; treat that push as publication.
