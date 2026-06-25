import { LookupGrid } from './lookupGrid.js';
import { isInside, rk4Step } from './integrator.js';
import type {
  BoundingBox,
  Streamline,
  StreamlinePoint,
  StreamlinesHandle,
  StreamlinesOptions,
  StreamlinesResult,
  Vector,
  VectorField,
} from './types.js';

const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

const yieldToEventLoop = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

interface Resolved {
  dSep: number;
  dTest: number;
  stepSize: number;
  minPoints: number;
  maxPoints: number;
  timeBudgetMs: number;
  bbox: BoundingBox;
  seed: Vector;
}

function resolveOptions(options: StreamlinesOptions): Resolved {
  const bbox: BoundingBox = options.boundingBox ?? {
    left: 0,
    top: 0,
    width: 100,
    height: 100,
  };
  const dSep = options.dSep ?? 10;
  const dTest = options.dTest ?? dSep / 2;
  if (dSep <= 0) throw new Error('dSep must be > 0');
  if (dTest <= 0 || dTest > dSep) throw new Error('dTest must be in (0, dSep]');

  return {
    dSep,
    dTest,
    stepSize: options.stepSize ?? dSep / 2,
    minPoints: options.minPointsPerStreamline ?? 2,
    maxPoints: options.maxPointsPerStreamline ?? 10000,
    timeBudgetMs: options.timeBudgetMs ?? 16,
    bbox,
    seed: options.seed ?? {
      x: bbox.left + bbox.width / 2,
      y: bbox.top + bbox.height / 2,
    },
  };
}

/** Walk the field from `seed` in one direction, returning the path (excludes seed). */
function integrateDirection(
  field: VectorField,
  seed: Vector,
  step: number,
  cfg: Resolved,
  committed: LookupGrid,
): Vector[] {
  const points: Vector[] = [];
  // A small per-half grid of "settled" points lets us detect the streamline
  // curling back onto itself without flagging the points we just laid down.
  const selfGrid = new LookupGrid(cfg.bbox, cfg.dSep);
  const skip = Math.ceil(cfg.dTest / cfg.stepSize) + 1;
  const pending: Vector[] = [];

  let current: Vector = seed;
  for (let i = 0; i < cfg.maxPoints; i++) {
    const next = rk4Step(field, current.x, current.y, step);
    if (!next) break; // left the domain
    if (!isInside(next, cfg.bbox)) break;
    // Collision with another streamline.
    if (!committed.isFartherThan(next.x, next.y, cfg.dTest)) break;
    // Self-collision (a closed loop) — ignore the freshly placed tail.
    if (!selfGrid.isFartherThan(next.x, next.y, cfg.dTest)) break;

    points.push(next);
    pending.push(next);
    if (pending.length > skip) {
      const settled = pending.shift()!;
      selfGrid.add(settled.x, settled.y, 0);
    }
    current = next;
  }
  return points;
}

function buildStreamline(
  field: VectorField,
  seed: Vector,
  cfg: Resolved,
  committed: LookupGrid,
): Vector[] | null {
  // Seed must clear existing streamlines by the full separation distance.
  if (!committed.isFartherThan(seed.x, seed.y, cfg.dSep)) return null;
  if (!isInside(seed, cfg.bbox)) return null;

  const forward = integrateDirection(field, seed, cfg.stepSize, cfg, committed);
  const backward = integrateDirection(field, seed, -cfg.stepSize, cfg, committed);

  const path: Vector[] = [];
  for (let i = backward.length - 1; i >= 0; i--) path.push(backward[i]!);
  path.push(seed);
  for (const p of forward) path.push(p);

  return path.length >= cfg.minPoints ? path : null;
}

/** Perpendicular seed candidates spaced dSep on either side of a streamline. */
function* seedCandidates(
  field: VectorField,
  path: Vector[],
  cfg: Resolved,
): Generator<Vector> {
  const stride = Math.max(1, Math.round(cfg.dSep / cfg.stepSize));
  for (let i = 0; i < path.length; i += stride) {
    const p = path[i]!;
    const v = field(p.x, p.y);
    if (!v) continue;
    const len = Math.hypot(v.x, v.y);
    if (!(len > 0)) continue;
    // Unit normal to the local flow direction.
    const nx = -v.y / len;
    const ny = v.x / len;
    yield { x: p.x + nx * cfg.dSep, y: p.y + ny * cfg.dSep };
    yield { x: p.x - nx * cfg.dSep, y: p.y - ny * cfg.dSep };
  }
}

/** Shared state and step logic backing both the async and sync entry points. */
interface Runner {
  /** Next seed to try, or `null` when growth queue and fallback are exhausted. */
  nextSeed(): Vector | null;
  /** Build and (if accepted) commit one streamline from `seed`. */
  step(seed: Vector): void;
  /** Run the post-processing pass and assemble the result. */
  finalize(cancelled: boolean): StreamlinesResult;
}

function createRunner(options: StreamlinesOptions, cfg: Resolved): Runner {
  const field = options.vectorField;
  const grid = new LookupGrid(cfg.bbox, cfg.dSep);
  const streamlines: Streamline[] = [];

  // FIFO of candidate seeds, walked with an index pointer (no O(n) shifts).
  const queue: Vector[] = [cfg.seed];
  let head = 0;
  let nextId = 0;

  // Once the growth queue drains, fall back to a coarse grid sweep so that
  // regions the streamline-growth never reached (e.g. across a singularity or
  // a disconnected sub-domain) still get covered.
  const fallbackStep = cfg.dSep;
  const fallbackCols = Math.max(1, Math.ceil(cfg.bbox.width / fallbackStep));
  const fallbackRows = Math.max(1, Math.ceil(cfg.bbox.height / fallbackStep));
  let fallbackIndex = 0;
  const nextFallbackSeed = (): Vector | null => {
    if (fallbackIndex >= fallbackCols * fallbackRows) return null;
    const col = fallbackIndex % fallbackCols;
    const row = Math.floor(fallbackIndex / fallbackCols);
    fallbackIndex++;
    return {
      x: cfg.bbox.left + (col + 0.5) * fallbackStep,
      y: cfg.bbox.top + (row + 0.5) * fallbackStep,
    };
  };

  const commit = (path: Vector[]): void => {
    const id = nextId++;
    const points: StreamlinePoint[] = path.map((p) => ({
      x: p.x,
      y: p.y,
      // Finalized in the post-processing pass once every streamline exists.
      distanceToNearest: Infinity,
    }));
    const streamline: Streamline = { id, points };
    streamlines.push(streamline);
    for (const p of points) {
      grid.add(p.x, p.y, id);
      options.onPointAdded?.(p, streamline);
    }
    options.onStreamlineAdded?.(streamline);
    for (const candidate of seedCandidates(field, path, cfg)) {
      queue.push(candidate);
    }
  };

  const finalizeDistances = (): number => {
    let count = 0;
    for (const sl of streamlines) {
      for (const p of sl.points) {
        p.distanceToNearest = grid.nearestOtherDistance(p.x, p.y, sl.id);
        count++;
      }
    }
    return count;
  };

  return {
    nextSeed(): Vector | null {
      if (head < queue.length) return queue[head++]!;
      return nextFallbackSeed();
    },
    step(seed: Vector): void {
      const path = buildStreamline(field, seed, cfg, grid);
      if (path) commit(path);
    },
    finalize(cancelled: boolean): StreamlinesResult {
      const pointCount = finalizeDistances();
      const result: StreamlinesResult = {
        streamlines,
        finished: !cancelled,
        reason: cancelled ? 'cancelled' : 'completed',
        pointCount,
      };
      options.onComplete?.(result);
      return result;
    },
  };
}

/**
 * Compute evenly-spaced streamlines of a 2D vector field.
 *
 * Returns immediately with a {@link StreamlinesHandle}; the work runs
 * cooperatively on the event loop. Await `handle.done` for the final result
 * (every point carries its finalized `distanceToNearest`), or call
 * `handle.cancel()` to stop early.
 *
 * Use {@link computeStreamlinesSync} instead when you want the result returned
 * directly and don't need cooperative yielding or cancellation.
 */
export function computeStreamlines(
  options: StreamlinesOptions,
): StreamlinesHandle {
  const cfg = resolveOptions(options);
  const runner = createRunner(options, cfg);

  let cancelled = false;
  let settled = false;

  const run = async (): Promise<StreamlinesResult> => {
    // Yield once before doing any work so the caller can hold the handle and
    // (e.g.) cancel synchronously before the loop begins.
    await Promise.resolve();

    let lastYield = now();
    while (!cancelled) {
      const seed = runner.nextSeed();
      if (!seed) break; // growth queue and fallback sweep both exhausted

      runner.step(seed);

      if (now() - lastYield >= cfg.timeBudgetMs) {
        await yieldToEventLoop();
        lastYield = now();
      }
    }

    const result = runner.finalize(cancelled);
    settled = true;
    return result;
  };

  const done = run();

  return {
    done,
    cancel(): void {
      cancelled = true;
    },
    get finished(): boolean {
      return settled;
    },
  };
}

/**
 * Synchronous variant of {@link computeStreamlines}.
 *
 * Runs the entire computation to completion on the calling thread and returns
 * the {@link StreamlinesResult} directly — no Promise, no cooperative yielding,
 * and no `cancel()`. The `timeBudgetMs` option is ignored. Prefer this in
 * scripts, workers, or other contexts where blocking is acceptable; use the
 * async {@link computeStreamlines} when you need to keep a UI responsive or to
 * cancel mid-run.
 */
export function computeStreamlinesSync(
  options: StreamlinesOptions,
): StreamlinesResult {
  const cfg = resolveOptions(options);
  const runner = createRunner(options, cfg);

  let seed: Vector | null;
  while ((seed = runner.nextSeed())) {
    runner.step(seed);
  }

  return runner.finalize(false);
}
