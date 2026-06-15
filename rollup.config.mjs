import esbuild, { minify } from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';

const input = 'src/index.ts';
const umdName = 'streamlines';
const banner = '/*! @matthewjacobson/ess | MIT License */';

export default [
  {
    input,
    plugins: [esbuild({ target: 'es2020', sourceMap: true })],
    output: [
      { file: 'dist/streamlines.mjs', format: 'es', sourcemap: true, banner },
      { file: 'dist/streamlines.cjs', format: 'cjs', sourcemap: true, exports: 'named', banner },
      {
        file: 'dist/streamlines.umd.js',
        format: 'umd',
        name: umdName,
        exports: 'named',
        sourcemap: true,
        banner,
      },
      {
        file: 'dist/streamlines.umd.min.js',
        format: 'umd',
        name: umdName,
        exports: 'named',
        sourcemap: true,
        banner,
        plugins: [minify()],
      },
    ],
  },
  {
    input,
    plugins: [dts()],
    output: { file: 'dist/streamlines.d.ts', format: 'es' },
  },
];
