import type { BoundingBox, Vector, VectorField } from './types.js';

/** Read the field and return a unit-length direction, or null if undefined/zero. */
function unitField(field: VectorField, x: number, y: number): Vector | null {
  const v = field(x, y);
  if (!v) return null;
  const len = Math.hypot(v.x, v.y);
  if (!(len > 0) || !Number.isFinite(len)) return null;
  return { x: v.x / len, y: v.y / len };
}

/**
 * One classic RK4 step of length `h` along the (normalized) field direction.
 * Returns the next point, or null if the field is undefined at any sample —
 * which means we have walked out of the domain and the streamline should end.
 */
export function rk4Step(
  field: VectorField,
  x: number,
  y: number,
  h: number,
): Vector | null {
  const k1 = unitField(field, x, y);
  if (!k1) return null;
  const k2 = unitField(field, x + (h / 2) * k1.x, y + (h / 2) * k1.y);
  if (!k2) return null;
  const k3 = unitField(field, x + (h / 2) * k2.x, y + (h / 2) * k2.y);
  if (!k3) return null;
  const k4 = unitField(field, x + h * k3.x, y + h * k3.y);
  if (!k4) return null;

  return {
    x: x + (h / 6) * (k1.x + 2 * k2.x + 2 * k3.x + k4.x),
    y: y + (h / 6) * (k1.y + 2 * k2.y + 2 * k3.y + k4.y),
  };
}

export function isInside(p: Vector, bbox: BoundingBox): boolean {
  return (
    p.x >= bbox.left &&
    p.x <= bbox.left + bbox.width &&
    p.y >= bbox.top &&
    p.y <= bbox.top + bbox.height
  );
}
