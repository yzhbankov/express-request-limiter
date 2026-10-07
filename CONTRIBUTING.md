# Contributing

Thanks for helping improve express-request-limiter.

## Setup

```sh
git clone https://github.com/yzhbankov/express-request-limiter.git
cd express-request-limiter
npm install
npm run check
```

`npm run check` runs lint, the type check, the build, the ESM/CJS smoke
tests, and the Vitest suite against Express 5 and Express 4. CI runs the same
on Node 20, 22 and 24.

## Making changes

- Open an issue first for behaviour changes or new options so the design can be discussed.
- Keep pull requests focused. One fix or feature per PR.
- Add or update tests for every behaviour change. Coverage thresholds are enforced (`npm run test:coverage`).
- Update `src/types.ts`, the README options table, `docs/api.md`, `llms.txt` and `CHANGELOG.md` when the public API changes. `AGENTS.md` has a checklist.
- Run `npm run bench` before and after performance-sensitive changes and mention the numbers in the PR.

## Code style

ESLint and typescript-eslint enforce the basics (`npm run lint`). Beyond that:
TypeScript in `src/`, ESM elsewhere, 2-space indentation, single quotes,
comments that explain why.

## Commit messages

Use the imperative mood ("Fix double release on client abort"). Reference
issues where relevant.

## Reporting bugs

Include the package version, Node version, Express version (if any), a minimal
reproduction, and what you expected to happen.
