# @spiritagent/site

Marketing and docs site for Spirit (Next.js + Fumadocs).

Preview: https://next.spirit.dev

## Development

Run from the **repository root** (this package is a pnpm workspace member):

```bash
corepack enable
pnpm install
pnpm run dev:site
```

Equivalent: `pnpm --filter @spiritagent/site dev`.

**Requirements:** Node.js 24+ (see repo-root `.nvmrc`), pnpm 12+.

## Vercel

Build settings live in [`vercel.json`](./vercel.json). After this package lands on `SpiritAgents/spirit`, switch the existing Vercel project (keep `spirit.dev` / `next.spirit.dev` on the same project):

1. **Settings → Git**: disconnect `spirit.dev`, connect `SpiritAgents/spirit`.
2. **Root Directory**: `apps/site`.
3. Enable **Include source files outside of the Root Directory**.
4. Leave Install / Build / Output empty so `vercel.json` applies.
5. Node.js **24**. Suggested env: `ENABLE_EXPERIMENTAL_COREPACK=1`. Optional: `SITE_URL=https://spirit.dev`.
6. Redeploy and confirm the install log scopes `@spiritagent/site` (no Electron).

Do not commit `.vercel/` (`vercel link` output is gitignored).
