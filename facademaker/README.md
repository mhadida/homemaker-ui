# Facademaker

Standalone Next.js 16 application extracted from Homemaker UI's former
`/facade` route. It includes the parametric facade editor, street-network
editor, real-city context import, and the offline Amsterdam demo fixture.

## Run locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open <http://localhost:3000>. The AI prompt is optional; copy `.env.example`
to `.env.local` and provide an AI Gateway key to enable it. Direct editing,
local prompt parsing, terrain/building/street import, and the offline demo do
not require that key.

While this copy sits inside Homemaker UI, `next.config.ts` can use the parent
dependency installation. After the directory moves to its final repository and
`npm install` creates local dependencies, it automatically uses its own root.

The stable classic WebGL renderer is the default. Use `?webgpu` to exercise the
experimental native WebGPU path or `?webgl2` to force WebGPURenderer's WebGL2
backend.

## Verify

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The extraction deliberately keeps the original pure-function tests beside the
facade, street, and geo modules. See `AUDIT.md` for the post-extraction review.
