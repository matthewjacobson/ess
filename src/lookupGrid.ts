import type { BoundingBox } from './types.js';

interface GridPoint {
  x: number;
  y: number;
  streamlineId: number;
}

/**
 * Uniform spatial hash grid used both to enforce streamline separation during
 * integration and to answer nearest-other-streamline queries afterwards.
 *
 * Cells are keyed by integer coordinates. The cell size is chosen so that any
 * point within the separation distance of a query falls in the query cell or
 * one of its immediate neighbors, keeping separation tests O(1) on average.
 */
export class LookupGrid {
  private readonly cellSize: number;
  private readonly cells = new Map<number, GridPoint[]>();
  private readonly cols: number;

  constructor(bbox: BoundingBox, cellSize: number) {
    this.cellSize = cellSize;
    // Number of columns spanning the box; used to fold (cx, cy) into one key.
    // Padded generously so points slightly outside the box still get a key.
    this.cols = Math.max(1, Math.ceil(bbox.width / cellSize)) + 4;
  }

  private cellOf(value: number, origin: number): number {
    return Math.floor((value - origin) / this.cellSize);
  }

  private keyOf(cx: number, cy: number): number {
    // Cantor-style fold into a single integer key. Offsetting keeps negatives
    // and the modest grid sizes we deal with well clear of collisions.
    return (cy + 1e7) * 2e7 + (cx + 1e7);
  }

  add(x: number, y: number, streamlineId: number): void {
    const cx = this.cellOf(x, 0);
    const cy = this.cellOf(y, 0);
    const key = this.keyOf(cx, cy);
    const bucket = this.cells.get(key);
    const point: GridPoint = { x, y, streamlineId };
    if (bucket) bucket.push(point);
    else this.cells.set(key, [point]);
  }

  /**
   * Is `(x, y)` at least `distance` away from every stored point (optionally
   * ignoring one streamline)? Used to validate seeds and to detect collisions
   * while integrating.
   */
  isFartherThan(
    x: number,
    y: number,
    distance: number,
    ignoreStreamlineId?: number,
  ): boolean {
    const d2 = distance * distance;
    const reach = Math.ceil(distance / this.cellSize);
    const cx = this.cellOf(x, 0);
    const cy = this.cellOf(y, 0);
    for (let oy = -reach; oy <= reach; oy++) {
      for (let ox = -reach; ox <= reach; ox++) {
        const bucket = this.cells.get(this.keyOf(cx + ox, cy + oy));
        if (!bucket) continue;
        for (const p of bucket) {
          if (p.streamlineId === ignoreStreamlineId) continue;
          const dx = p.x - x;
          const dy = p.y - y;
          if (dx * dx + dy * dy < d2) return false;
        }
      }
    }
    return true;
  }

  /**
   * Distance from `(x, y)` to the closest stored point that does *not* belong
   * to `ownStreamlineId`. Returns `Infinity` if there is no such point.
   *
   * Searches expanding square rings of cells and stops once no unsearched ring
   * could contain a closer point than the best found so far.
   */
  nearestOtherDistance(x: number, y: number, ownStreamlineId: number): number {
    const cx = this.cellOf(x, 0);
    const cy = this.cellOf(y, 0);
    let best2 = Infinity;
    const maxRing = this.cols + 2;

    for (let ring = 0; ring <= maxRing; ring++) {
      // Closest a point in this ring of cells can possibly be to (x, y).
      // Once that lower bound exceeds the best distance found, we are done.
      if (ring > 0) {
        const minPossible = (ring - 1) * this.cellSize;
        if (minPossible * minPossible > best2) break;
      }
      let foundAny = false;
      for (let oy = -ring; oy <= ring; oy++) {
        const onYEdge = oy === -ring || oy === ring;
        for (let ox = -ring; ox <= ring; ox++) {
          // Only visit the cells on the perimeter of this ring.
          if (!onYEdge && ox !== -ring && ox !== ring) continue;
          const bucket = this.cells.get(this.keyOf(cx + ox, cy + oy));
          if (!bucket) continue;
          for (const p of bucket) {
            if (p.streamlineId === ownStreamlineId) continue;
            const dx = p.x - x;
            const dy = p.y - y;
            const dist2 = dx * dx + dy * dy;
            if (dist2 < best2) best2 = dist2;
            foundAny = true;
          }
        }
      }
      // Safety: if we have a candidate and have searched a full ring beyond the
      // one that produced it, the break condition above will catch it. The
      // `foundAny` flag is only used to avoid an unbounded empty-grid scan.
      if (!foundAny && best2 === Infinity && ring > maxRing) break;
    }
    return best2 === Infinity ? Infinity : Math.sqrt(best2);
  }
}
