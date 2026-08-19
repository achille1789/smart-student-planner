const { build } = require('esbuild');

build({
    bundle: true,
    minify: true,
    sourcemap: true,
    entryPoints: ['src/app.ts'],
    platform: 'node',
    outfile: 'dist/index.js',
});
