import { describe, expect, it } from 'vitest';
import { computeStreamlines } from '../src/index.js';
import type { BoundingBox } from '../src/index.js';

const bbox: BoundingBox = { left: -50, top: -50, width: 100, height: 100 };

describe('computeStreamlines', () => {
  it('covers a rotational field with multiple separated streamlines', async () => {
    const { done } = computeStreamlines({
      vectorField: (x, y) => ({ x: -y, y: x }),
      boundingBox: bbox,
      seed: { x: 10, y: 0 },
      dSep: 5,
    });
    const result = await done;

    expect(result.finished).toBe(true);
    expect(result.reason).toBe('completed');
    expect(result.streamlines.length).toBeGreaterThan(1);
    expect(result.pointCount).toBeGreaterThan(0);
  });

  it('keeps every point inside the bounding box', async () => {
    const result = await computeStreamlines({
      vectorField: (x, y) => ({ x: -y, y: x }),
      boundingBox: bbox,
      dSep: 6,
    }).done;

    for (const sl of result.streamlines) {
      for (const p of sl.points) {
        expect(p.x).toBeGreaterThanOrEqual(bbox.left - 1e-6);
        expect(p.x).toBeLessThanOrEqual(bbox.left + bbox.width + 1e-6);
        expect(p.y).toBeGreaterThanOrEqual(bbox.top - 1e-6);
        expect(p.y).toBeLessThanOrEqual(bbox.top + bbox.height + 1e-6);
      }
    }
  });

  it('finalizes a per-point distance to the nearest other streamline', async () => {
    const result = await computeStreamlines({
      vectorField: (x, y) => ({ x: -y, y: x }),
      boundingBox: bbox,
      dSep: 5,
      dTest: 2.5,
    }).done;

    let checked = 0;
    for (const sl of result.streamlines) {
      for (const p of sl.points) {
        expect(Number.isNaN(p.distanceToNearest)).toBe(false);
        // Separation guarantee: nothing from another streamline is closer
        // than dTest (allowing a small numerical slack).
        expect(p.distanceToNearest).toBeGreaterThan(2.5 - 0.5);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('matches a brute-force nearest-distance for a sample of points', async () => {
    const result = await computeStreamlines({
      vectorField: (x, y) => ({ x: -y, y: x }),
      boundingBox: bbox,
      dSep: 5,
    }).done;

    const all = result.streamlines.flatMap((sl) =>
      sl.points.map((p) => ({ ...p, id: sl.id })),
    );
    // Brute force a handful of points and compare against the grid result.
    const sample = all.filter((_, i) => i % 37 === 0);
    for (const p of sample) {
      let brute = Infinity;
      for (const q of all) {
        if (q.id === p.id) continue;
        brute = Math.min(brute, Math.hypot(q.x - p.x, q.y - p.y));
      }
      expect(p.distanceToNearest).toBeCloseTo(brute, 6);
    }
  });

  it('reports cancellation and still finalizes the points it produced', async () => {
    const handle = computeStreamlines({
      vectorField: (x, y) => ({ x: -y, y: x }),
      boundingBox: bbox,
      dSep: 2,
    });
    handle.cancel();
    const result = await handle.done;

    expect(result.finished).toBe(false);
    expect(result.reason).toBe('cancelled');
    expect(handle.finished).toBe(true);
    for (const sl of result.streamlines) {
      for (const p of sl.points) {
        expect(Number.isNaN(p.distanceToNearest)).toBe(false);
      }
    }
  });

  it('fires onComplete exactly once with the result', async () => {
    let calls = 0;
    let seen: unknown = null;
    const handle = computeStreamlines({
      vectorField: () => ({ x: 1, y: 0 }),
      boundingBox: bbox,
      dSep: 8,
      onComplete: (r) => {
        calls++;
        seen = r;
      },
    });
    const result = await handle.done;
    expect(calls).toBe(1);
    expect(seen).toBe(result);
  });

  it('treats a null field as the edge of the domain', async () => {
    // Field only defined in the right half-plane.
    const result = await computeStreamlines({
      vectorField: (x, y) => (x >= 0 ? { x: 0, y: 1 } : null),
      boundingBox: bbox,
      seed: { x: 10, y: -40 },
      dSep: 5,
    }).done;

    for (const sl of result.streamlines) {
      for (const p of sl.points) {
        expect(p.x).toBeGreaterThanOrEqual(-1e-6);
      }
    }
  });
});
