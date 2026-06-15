/** A point in the vector field's coordinate space. */
export interface Vector {
  x: number;
  y: number;
}

/** An axis-aligned region of the plane that streamlines are confined to. */
export interface BoundingBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * A sampled point on a streamline.
 *
 * `distanceToNearest` is the Euclidean distance from this point to the closest
 * point belonging to *any other* streamline. It is finalized only once the
 * whole field has been computed (later streamlines can become the new nearest
 * neighbor), so it is meaningful on the resolved {@link StreamlinesResult},
 * not inside the `onPointAdded` / `onStreamlineAdded` callbacks. When a point
 * has no neighbor on any other streamline it is `Infinity`.
 */
export interface StreamlinePoint extends Vector {
  distanceToNearest: number;
}

/** A single integrated streamline. */
export interface Streamline {
  /** Monotonically increasing id, in the order streamlines were accepted. */
  id: number;
  points: StreamlinePoint[];
}

/** Why the computation stopped. */
export type StopReason =
  /** The seeding queue drained — the field is fully covered. */
  | 'completed'
  /** `cancel()` was called before the field was fully covered. */
  | 'cancelled';

/** The final result, available once the run settles. */
export interface StreamlinesResult {
  streamlines: Streamline[];
  /** `true` when the run drained naturally, `false` when cancelled. */
  finished: boolean;
  reason: StopReason;
  /** Total number of sampled points across all streamlines. */
  pointCount: number;
}

export type VectorField = (
  x: number,
  y: number,
) => Vector | null | undefined;

export interface StreamlinesOptions {
  /**
   * The field to trace. Return the flow direction at `(x, y)`; magnitude is
   * ignored (vectors are normalized). Return `null`/`undefined` to mark a point
   * as outside the domain, which stops the streamline passing through it.
   */
  vectorField: VectorField;

  /** Region streamlines are confined to. Defaults to a 100x100 box at origin. */
  boundingBox?: BoundingBox;

  /** First seed point. Defaults to the center of the bounding box. */
  seed?: Vector;

  /**
   * Target separation between adjacent streamlines, in field units. New
   * streamlines are seeded this far from existing ones. Default `10`.
   */
  dSep?: number;

  /**
   * Distance at which an in-progress streamline is considered to have collided
   * with an existing one and is stopped. Must be `<= dSep`. Default `dSep / 2`.
   */
  dTest?: number;

  /** Integration step size in field units. Default `dSep / 2`. */
  stepSize?: number;

  /** Discard streamlines shorter than this many points. Default `2`. */
  minPointsPerStreamline?: number;

  /** Hard cap on points in one streamline (loop guard). Default `10000`. */
  maxPointsPerStreamline?: number;

  /**
   * Cooperative-yield budget in milliseconds. The loop yields to the event loop
   * after running this long, keeping the UI responsive. Default `16`.
   */
  timeBudgetMs?: number;

  /** Called once per accepted streamline, as it is added. */
  onStreamlineAdded?: (streamline: Streamline) => void;

  /** Called once per sampled point, as it is added. */
  onPointAdded?: (point: StreamlinePoint, streamline: Streamline) => void;

  /** Called exactly once when the run settles (completed or cancelled). */
  onComplete?: (result: StreamlinesResult) => void;
}

/** Handle returned by {@link computeStreamlines}. */
export interface StreamlinesHandle {
  /** Resolves when the run settles. Never rejects on cancellation. */
  readonly done: Promise<StreamlinesResult>;
  /** Request an early stop. Idempotent. Resolves `done` with `reason: 'cancelled'`. */
  cancel(): void;
  /** `true` once the run has settled. */
  readonly finished: boolean;
}
