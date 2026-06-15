// Run after `npm run build`:  node examples/node-example.mjs
import { computeStreamlines } from '../dist/streamlines.mjs';

const handle = computeStreamlines({
  // A simple rotational field.
  vectorField: (x, y) => ({ x: -y, y: x }),
  boundingBox: { left: -50, top: -50, width: 100, height: 100 },
  seed: { x: 10, y: 0 },
  dSep: 8,
  onStreamlineAdded: (sl) => {
    console.log(`+ streamline ${sl.id} (${sl.points.length} points)`);
  },
});

const result = await handle.done;

console.log(`\nfinished: ${result.finished}  reason: ${result.reason}`);
console.log(`streamlines: ${result.streamlines.length}  points: ${result.pointCount}`);

const first = result.streamlines[0].points[0];
console.log(
  `\nfirst point (${first.x.toFixed(2)}, ${first.y.toFixed(2)}) ` +
    `is ${first.distanceToNearest.toFixed(3)} from its nearest neighbor`,
);
