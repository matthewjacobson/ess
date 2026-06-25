# ess — evenly-spaced streamlines

Compute **evenly-spaced streamlines** of a 2D vector field, in the spirit of
[anvaka/streamlines](https://github.com/anvaka/streamlines) and the
Jobard & Lefer (1997) placement algorithm — rewritten as a modern,
TypeScript-first library with two extra capabilities:

1. **Per-point spacing.** Every output point carries `distanceToNearest`: the
   Euclidean distance to the closest point on *any other* streamline. Handy for
   adaptive line width, opacity, glyph density, or detecting where the field is
   sparsely covered.
2. **An explicit completion signal.** `computeStreamlines` returns a handle with
   a `done` promise that resolves with a result (`{ finished, reason, ... }`),
   plus an `onComplete` callback and a `cancel()` method — so you always know
   when the process has stopped, and why.

Ships as **ESM**, **CommonJS**, and **UMD** (browser global / CDN), with bundled
TypeScript declarations.

## Install

```sh
npm install @matthewjacobson/ess
```

## Usage

### ESM / TypeScript

```ts
import { computeStreamlines } from '@matthewjacobson/ess';

const handle = computeStreamlines({
  // Return the flow direction at (x, y). Magnitude is ignored.
  // Return null/undefined for points outside the domain.
  vectorField: (x, y) => ({ x: -y, y: x }),
  boundingBox: { left: -50, top: -50, width: 100, height: 100 },
  seed: { x: 10, y: 0 },
  dSep: 8, // target spacing between adjacent streamlines
});

const result = await handle.done;

console.log(result.reason);           // 'completed'
console.log(result.streamlines.length);

for (const streamline of result.streamlines) {
  for (const p of streamline.points) {
    // p.x, p.y, and the distance to the nearest neighboring streamline:
    drawPoint(p.x, p.y, p.distanceToNearest);
  }
}
```

### Synchronous

If you don't need cooperative yielding or cancellation — e.g. in a script, a
worker, or server-side rendering — `computeStreamlinesSync` runs the whole
computation on the calling thread and returns the result directly (no promise,
no handle). It accepts the same options (`timeBudgetMs` is ignored):

```ts
import { computeStreamlinesSync } from '@matthewjacobson/ess';

const result = computeStreamlinesSync({
  vectorField: (x, y) => ({ x: -y, y: x }),
  boundingBox: { left: -50, top: -50, width: 100, height: 100 },
  dSep: 8,
});

console.log(result.reason, result.pointCount); // 'completed' …
```

Output is identical to the async variant for the same options. Because it blocks
until done it can't be cancelled, so `result.reason` is always `'completed'`.

### CommonJS

```js
const { computeStreamlines } = require('@matthewjacobson/ess');
computeStreamlines({ /* ... */ }).done.then((result) => { /* ... */ });
```

### Browser (UMD via CDN)

```html
<script src="https://unpkg.com/@matthewjacobson/ess"></script>
<script>
  streamlines.computeStreamlines({
    vectorField: (x, y) => ({ x: -y, y: x }),
    boundingBox: { left: -50, top: -50, width: 100, height: 100 },
  }).done.then((result) => console.log(result.reason, result.pointCount));
</script>
```

## Examples

The `examples/` folder has runnable demos:

| File | What it shows |
| --- | --- |
| `examples/node-example.mjs` | Minimal Node usage. Run `npm run build`, then `node examples/node-example.mjs`. |
| `examples/canvas.html` | Self-contained canvas renderer. Streamline **line width and color are driven by `distanceToNearest`** — thick/warm where coverage is sparse, thin/cool where lines pack tightly. Selectable fields and an adjustable `dSep`. Run `npm run build`, then open the file in a browser (it loads the local `dist/streamlines.umd.min.js`). |
| `examples/cdn-demo.html` | The same line-width-from-spacing idea, but loading the library straight from a CDN (`unpkg`) — no build step. Just open it in a browser. |

## Knowing when it stopped

The work runs cooperatively on the event loop (it yields periodically so it
won't freeze a UI). There are three ways to observe completion:

```ts
const handle = computeStreamlines({
  vectorField,
  onComplete: (result) => console.log('done:', result.reason),
});

// 1. Await the promise.
const result = await handle.done;

// 2. Inspect the handle synchronously at any time.
handle.finished; // boolean

// 3. Stop early — `done` still resolves, with reason 'cancelled'.
handle.cancel();
```

`result.reason` is `'completed'` when the field was fully covered, or
`'cancelled'` when `cancel()` was called first. Cancelling still finalizes the
`distanceToNearest` values for whatever was produced.

## How `distanceToNearest` works

While placing streamlines, every committed point is stored in a uniform spatial
hash grid tagged with its streamline id. After the run settles, each point is
queried against the grid (expanding ring search) for the closest point that
belongs to a *different* streamline.

Because a streamline added later can become a point's new nearest neighbor, the
value is only finalized on the resolved `result` — inside `onPointAdded` /
`onStreamlineAdded` it is still the placeholder `Infinity`. A point with no
other streamline anywhere in the field keeps `Infinity`.

## API

### `computeStreamlines(options): StreamlinesHandle`

#### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `vectorField` | `(x, y) => {x,y} \| null` | — (required) | Flow direction at a point; `null` = outside the domain. |
| `boundingBox` | `{left, top, width, height}` | `{0,0,100,100}` | Region streamlines are confined to. |
| `seed` | `{x, y}` | center of box | First seed point. |
| `dSep` | `number` | `10` | Target separation between adjacent streamlines. |
| `dTest` | `number` | `dSep / 2` | Collision distance that stops an in-progress streamline. Must be `≤ dSep`. |
| `stepSize` | `number` | `dSep / 2` | RK4 integration step. |
| `minPointsPerStreamline` | `number` | `2` | Discard streamlines shorter than this. |
| `maxPointsPerStreamline` | `number` | `10000` | Loop guard. |
| `timeBudgetMs` | `number` | `16` | How long to run between event-loop yields. |
| `onStreamlineAdded` | `(streamline) => void` | — | Fires per accepted streamline. |
| `onPointAdded` | `(point, streamline) => void` | — | Fires per sampled point. |
| `onComplete` | `(result) => void` | — | Fires once when the run settles. |

#### Returns — `StreamlinesHandle`

| Member | Type | Description |
| --- | --- | --- |
| `done` | `Promise<StreamlinesResult>` | Resolves when the run settles. Never rejects on cancellation. |
| `cancel()` | `() => void` | Request an early stop (idempotent). |
| `finished` | `boolean` | `true` once settled. |

### `computeStreamlinesSync(options): StreamlinesResult`

Synchronous variant. Takes the same options as `computeStreamlines` (`timeBudgetMs`
is ignored) and returns the `StreamlinesResult` directly instead of a handle — no
promise, no `cancel()`. `result.reason` is always `'completed'`. Use it when
blocking is fine; use the async `computeStreamlines` to keep a UI responsive or to
cancel mid-run.

#### `StreamlinesResult`

```ts
interface StreamlinesResult {
  streamlines: Streamline[];          // { id, points: StreamlinePoint[] }
  finished: boolean;                  // true if completed, false if cancelled
  reason: 'completed' | 'cancelled';
  pointCount: number;                 // total points across all streamlines
}

interface StreamlinePoint {
  x: number;
  y: number;
  distanceToNearest: number;          // to the nearest point on another streamline
}
```

## Notes & differences from the original

- Beyond growing seeds from existing streamlines, this implementation also
  sweeps a coarse fallback grid of seeds once the growth queue drains, so
  disconnected sub-domains and regions across field singularities still get
  covered.
- Integration uses classic RK4 with normalized field directions, so `stepSize`
  is a true spatial step.
- Self-intersection within a single integration direction is detected; a closed
  loop formed across the two halves is bounded by `maxPointsPerStreamline`.

## Build outputs

| File | Format | For |
| --- | --- | --- |
| `dist/streamlines.mjs` | ESM | `import`, bundlers |
| `dist/streamlines.cjs` | CommonJS | `require` |
| `dist/streamlines.umd.js` | UMD | browser `<script>`, AMD |
| `dist/streamlines.umd.min.js` | UMD (minified) | CDN (`unpkg`, `jsdelivr`) |
| `dist/streamlines.d.ts` | Types | TypeScript |

```sh
npm run build      # produce dist/
npm test           # run the test suite
npm run typecheck  # tsc --noEmit
```

## Node versions

There are two separate requirements — don't conflate them:

- **Using the package** (runtime): **Node ≥ 16**, declared in `engines`. The
  build output is ES2020 and relies only on `setTimeout` and `performance.now`
  (with a `Date.now` fallback), so it runs anywhere from Node 16 up — and in
  browsers.
- **Developing the package** (build/test toolchain): **Node 20 LTS**, pinned in
  [`.nvmrc`](./.nvmrc). Run `nvm use` to match it. The test runner (`vitest@3`)
  needs Node 18/20/22.

If you later bump the dev tooling to `vitest@4`, note it drops `esbuild` (which
is why the `overrides` pin in `package.json` exists) but requires **Node ≥
20.12** — update `.nvmrc` accordingly at that point.

## License

MIT
