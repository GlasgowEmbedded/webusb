import debounce from 'lodash/debounce';
import type { PyodideAPI } from './vendor/pyodide';

import type { FileTreeNode } from './types';
import { HOME_DIRECTORY, MOUNT_DIRECTORY } from './config';

export class GlasgowFileSystem {
    #pyodide: PyodideAPI;
    #nativeFSMountRoot: unknown | null = null;
    #updateCallbacks = new Map<RegExp, Set<() => void>>();

    constructor({ pyodide }: { pyodide: PyodideAPI }) {
        this.#pyodide = pyodide;

        const runUpdateCallbacks = (path: string) => {
            for (const [regexp, callbacks] of this.#updateCallbacks) {
                if (regexp.test(path)) {
                    callbacks.forEach(callback => callback());
                }
            }
        };
        const trackingDelegate = this.#pyodide.FS.trackingDelegate;
        trackingDelegate.onMakeDirectory = (path: string, mode: number) => {
            runUpdateCallbacks(path);
        };
        trackingDelegate.onMakeSymlink = (_sourcePath: string, destPath: string) => {
            runUpdateCallbacks(destPath);
        };
        trackingDelegate.onMovePath = (oldPath: string, newPath: string) => {
            runUpdateCallbacks(oldPath);
            runUpdateCallbacks(newPath);
        };
        trackingDelegate.onDeletePath = (path: string) => {
            runUpdateCallbacks(path);
        };
        trackingDelegate.onCloseFile = (path: string) => {
            runUpdateCallbacks(path);
        };
    }

    subscribeToUpdates(regexp: RegExp, callback: () => void) {
        const debouncedCallback = debounce(() => callback(), 0);

        let registeredCallbacks = this.#updateCallbacks.get(regexp);
        if (!registeredCallbacks)
            this.#updateCallbacks.set(regexp, registeredCallbacks = new Set());
        registeredCallbacks.add(debouncedCallback);

        return () => {
            registeredCallbacks.delete(debouncedCallback);
            if (registeredCallbacks.size === 0)
                this.#updateCallbacks.delete(regexp);
        };
    }

    readFileTree(path: string) {
        let result = [];
        let names = this.#pyodide.FS.readdir(path);
        for (let name of names) {
            if (name === '.' || name === '..') {
                continue;
            }

            let node: FileTreeNode = {
                name,
                path: `${path}/${name}`,
            };
            let stat = this.#pyodide.FS.stat(node.path, true);
            if (this.#pyodide.FS.isDir(stat.mode)) {
                node.children = this.readFileTree(node.path);
            }
            result.push(node);
        }
        result.sort((a, b) => {
            const compare = (a: string | number, b: string | number) => {
                if (a < b) return -1;
                if (a > b) return 1;
                return 0;
            };

            let result = 0;
            if (result === 0) result = compare(Number(!!b.children), Number(!!a.children));
            if (result === 0) result = compare(a.name, b.name);
            return result;
        });
        return result;
    }

    readFile(path: string) {
        return this.#pyodide.FS.readFile(path) as Uint8Array<ArrayBuffer>;
    };

    createPath(
        path: string,
        type: 'file' | 'folder',
        fileContents: Uint8Array<ArrayBuffer> | null,
        dryRun: boolean,
    ) {
        const name = this.#pyodide.PATH.basename(path);

        if (['', '.', '..'].includes(name)) {
            throw 'The file name must not be . or ..';
        }
        if (name.includes('/')) {
            throw 'The file name must not include a slash';
        }

        let stat;
        try {
            stat = this.#pyodide.FS.stat(path, true);
        } catch (e) {}
        if (stat) {
            throw `A ${this.#pyodide.FS.isDir(stat.mode) ? 'folder' : 'file'} with the same name already exists`;
        }

        if (dryRun)
            return;

        switch (type) {
            case 'file': {
                this.#pyodide.FS.mkdirTree(this.#pyodide.PATH.dirname(path));
                const stream = this.#pyodide.FS.open(path, 'w+');
                this.#pyodide.FS.write(stream, fileContents!, 0, fileContents!.length, 0);
                this.#pyodide.FS.close(stream);
                break;
            }
            case 'folder': {
                this.#pyodide.FS.mkdirTree(path);
                break;
            }
        }
    };

    deletePath(path: string) {
        const deleteFile = (path: string) => {
            if (this.#pyodide.FS.isDir(this.#pyodide.FS.stat(path, true).mode)) {
                for (const file of this.#pyodide.FS.readdir(path)) {
                    if (file === '.' || file === '..') {
                        continue;
                    }
                    deleteFile(`${path}/${file}`);
                }
                this.#pyodide.FS.rmdir(path);
            } else {
                this.#pyodide.FS.unlink(path);
            }
        };
        deleteFile(path);
    }

    #ensureDoesNotExist(path: string) {
        let stat;
        try {
            stat = this.#pyodide.FS.stat(path, true);
        } catch (e) {}
        if (stat) {
            throw `A ${this.#pyodide.FS.isDir(stat.mode) ? 'folder' : 'file'} with the same name already exists`;
        }
    }

    duplicatePath(path: string, newPath: string, dryRun: boolean) {
        if (path === newPath)
            throw 'The path cannot be the same';

        this.#ensureDoesNotExist(newPath);

        if (dryRun)
            return;

        const duplicate = (path: string, newPath: string) => {
            const stat = this.#pyodide.FS.stat(path, true);
            if (this.#pyodide.FS.isDir(stat.mode)) {
                this.#pyodide.FS.mkdirTree(newPath);
                for (const file of this.#pyodide.FS.readdir(path)) {
                    if (file === '.' || file === '..') {
                        continue;
                    }
                    duplicate(this.#pyodide.PATH.join(path, file), this.#pyodide.PATH.join(newPath, file));
                }
            } else if (this.#pyodide.FS.isLink(stat.mode)) {
                const link = this.#pyodide.FS.readlink(path);
                this.#pyodide.FS.symlink(link, newPath);
            } else {
                const contents = this.#pyodide.FS.readFile(path);
                this.#pyodide.FS.writeFile(newPath, contents);
            }
        };
        duplicate(path, newPath);
    }

    renamePath(path: string, newPath: string, dryRun: boolean) {
        if (path === newPath)
            return;

        this.#ensureDoesNotExist(newPath);

        if (dryRun)
            return;

        this.#pyodide.FS.rename(path, newPath);
    }

    async mountHome() {
        this.#pyodide.FS.mkdirTree(HOME_DIRECTORY);
        const homeMountRoot = this.#pyodide.FS.mount(this.#pyodide.FS.filesystems.IDBFS, { autoPersist: true }, HOME_DIRECTORY);
        return new Promise<void>((resolve) => {
            this.#pyodide.FS.filesystems.IDBFS.syncfs(homeMountRoot.mount, true, (error: unknown) => {
                if (error !== null) {
                    console.log('[FS Error]', error);
                    return;
                }

                resolve();
            });
        });
    }

    async mountNativeFS(fileSystemHandle: FileSystemDirectoryHandle) {
        this.#pyodide.FS.mkdirTree(MOUNT_DIRECTORY);
        this.#nativeFSMountRoot = this.#pyodide.FS.mount(this.#pyodide.FS.filesystems.NATIVEFS_ASYNC, {
            fileSystemHandle,
        }, MOUNT_DIRECTORY);
        await this.syncFSFromBacking();
    }

    async unmountNativeFS() {
        this.#pyodide.FS.unmount(MOUNT_DIRECTORY);
        this.#pyodide.FS.rmdir(MOUNT_DIRECTORY);
        this.#nativeFSMountRoot = null;
    }

    async syncFSFromBacking() {
        if (!this.#nativeFSMountRoot) return;
        return await new Promise<void>((resolve, reject) => {
            this.#pyodide.FS.filesystems.NATIVEFS_ASYNC.syncfs((this.#nativeFSMountRoot as any).mount, true, (error: unknown) => {
                if (error !== null) {
                    console.log('[FS Error]', error);
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }

    async syncFSToBacking() {
        if (!this.#nativeFSMountRoot) return;
        return await new Promise<void>((resolve, reject) => {
            this.#pyodide.FS.filesystems.NATIVEFS_ASYNC.syncfs((this.#nativeFSMountRoot as any).mount, false, (error: unknown) => {
                if (error !== null) {
                    console.log('[FS Error]', error);
                    reject(error);
                    return;
                }

                resolve();
            });
        });
    }
}
