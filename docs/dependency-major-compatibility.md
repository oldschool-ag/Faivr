# Dependency major compatibility gates

Checked on 2026-10-14 against FAIVR's locked Next.js 16.3.8 toolchain.

## ESLint 10

**Status: deferred.** Next.js added explicit ESLint 10 compatibility in
[vercel/next.js#99628](https://github.com/vercel/next.js/pull/99628), released
after FAIVR's current `eslint-config-next` 16.3.8. The support change documents
peer warnings for upstream plugins even in the supported Next release.

Revisit when all of these are true:

1. `next` and `eslint-config-next` are deliberately upgraded together to 16.4
   or newer.
2. `npm ci`, `npm run lint`, typecheck, tests, and production build pass on the
   repository's supported Node versions.
3. The combined ESLint and TypeScript peer tree is supported without overrides.

## TypeScript 7

**Status: deferred.** Next.js 16.4 documents
[TypeScript 7 support](https://nextjs.org/docs/app/api-reference/config/typescript#using-typescript-7)
through the project-local `tsc` CLI. However, the
[`typescript-eslint` 8.71.2 package](https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.2/packages/typescript-eslint/package.json)
resolved by `eslint-config-next` 16.4 declares TypeScript `>=4.8.4 <6.1.0`, so
FAIVR's full lint/build toolchain does not officially support TypeScript 7 as
one warning-free dependency graph.

Revisit when `eslint-config-next` resolves a `typescript-eslint` release whose
published peer range includes TypeScript 7, then require clean install, lint,
typecheck, tests, and production build.

## Tailwind CSS 4

**Status: deferred.** Tailwind's
[upgrade guide](https://tailwindcss.com/docs/upgrade-guide) requires a PostCSS
plugin and CSS/config migration. This is a UI migration, not routine dependency
maintenance.

Revisit in a dedicated branch with desktop/mobile screenshot comparison,
production build, and explicit visual-regression review of every public page.
