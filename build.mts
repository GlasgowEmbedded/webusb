import * as process from 'node:process';
import * as child_process from 'node:child_process';
import * as esbuild from 'esbuild';
import metaUrlPlugin from '@chialab/esbuild-plugin-meta-url';

const gitCommit = child_process.execSync('git rev-parse HEAD', { encoding: 'utf-8' }).replace(/\n$/, '');

const mode = (process.argv[2] ?? 'build');
const target = 'chrome137';
const options = {
    logLevel: 'info',
    plugins: [
        metaUrlPlugin(),
    ],
    bundle: true,
    splitting: false,
    loader: {
        '.html': 'copy',
        '.py': 'text',
        '.json': 'file',
        '.wasm': 'file',
        '.asm.wasm': 'copy',
        '.zip': 'file',
        '.whl': 'file',
    },
    define: {
        'globalThis.IS_PRODUCTION': (mode === 'minify' ? 'true' : 'false'),
        'globalThis.GIT_COMMIT': `"${mode === 'minify' ? gitCommit : 'HEAD'}"`,
    },
    external: [
        'fs/promises', // @yowasp/yosys
        'node:*', // pyodide
        'fs', // pyodide
        'path', // pyodide
        'crypto', // pyodide
        'child_process', // pyodide
        'ws', // pyodide
    ],
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.css', '.json'],
    target: target,
    format: 'esm',
    sourcemap: (mode === 'minify'),
    minify: (mode === 'minify'),
    outdir: 'dist',
    publicPath: '.',
    entryPoints: {
        'index': 'src/index.html',
        'app': 'src/app.tsx',
        'pyodide.asm': 'src/vendor/pyodide/pyodide.asm.wasm',
    },
} satisfies esbuild.BuildOptions;

if (mode === 'build' || mode === 'minify') {
    await esbuild.build(options);
} else if (mode === 'watch') {
    const context = await esbuild.context(options);
    await context.watch();
} else if (mode === 'serve') {
    const context = await esbuild.context(options);
    await context.rebuild();
    await context.watch();
    // Specifying `servedir` is necessary for files built by meta URL plugin to be accessible.
    await context.serve({ servedir: 'dist', port: 8020 });
} else {
    console.error(`Usage: ${process.argv0} [build|watch|serve|minify]`);
}
