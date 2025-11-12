import * as path from 'node:path';
import * as esbuild from 'esbuild';
import * as babel from '@babel/core';
import { useRna } from '@chialab/esbuild-rna';

const solidPlugin = () => {
    const plugin: esbuild.Plugin = {
        name: 'solid',
        setup(pluginBuild) {
            let build = useRna(plugin, pluginBuild);

            build.onTransform({ loaders: ['jsx', 'tsx'] }, async (args) => {
                let { code, map } = await esbuild.transform(args.code, {
                    loader: 'tsx',
                    jsx: 'preserve',
                    sourcemap: true,
                    sourcefile: path.basename(args.path),
                });

                let result = await babel.transformAsync(code, {
                    presets: [
                        (await import('babel-preset-solid')).default,
                    ],
                    filename: path.basename(args.path),
                    sourceMaps: true,
                    inputSourceMap: map ? JSON.parse(map) : undefined,
                });

                return {
                    code: result.code,
                    map: result?.map,
                };
            });
        },
    };

    return plugin;
};

export default solidPlugin;
