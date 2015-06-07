import fs = require('fs');
import fse = require('fs-extra');
import path = require('path');
var symlinkOrCopySync = require('symlink-or-copy').sync;
import {wrapDiffingPlugin, DiffingBroccoliPlugin, DiffResult} from './diffing-broccoli-plugin';

interface MergeTreesOptions {
  overwrite?: boolean;
}

function directoryExists(dirname, cache) {
  if (cache[dirname]) return true;
  try { return cache[dirname] = fs.lstatSync(dirname).isDirectory(); }
  catch (e) { if (e.code !== "ENOENT") throw e; }
  return cache[dirname] = false;
}

function outputFileSync(sourcePath, destPath, cache) {
  let dirname = path.dirname(destPath);
  if (!directoryExists(dirname, cache)) {
    fse.mkdirsSync(dirname, {fs: fs});
  }
  symlinkOrCopySync(sourcePath, destPath);
}

export class MergeTrees implements DiffingBroccoliPlugin {
  private pathCache: {[key: string]: number[]} = Object.create(null);
  public options: MergeTreesOptions;
  private firstBuild: boolean = true;
  private inputPathsCache: {[key: string]: number} = Object.create(null);

  constructor(public inputPaths: string[], public cachePath: string,
              options: MergeTreesOptions = {}) {
    this.options = options || {};
  }

  rebuild(treeDiffs: DiffResult[]) {
    let overwrite = this.options.overwrite;
    let pathsToEmit: string[] = [];
    let pathsToRemove: string[] = [];
    let emitted: {[key: string]: boolean} = Object.create(null);
    let contains = (cache, val) => {
      for (let i = 0, ii = cache.length; i < ii; ++i) {
        if (cache[i] === val) return true;
      }
      return false;
    };

    let emit = (relativePath) => {
      // ASSERT(!emitted[relativePath]);
      pathsToEmit.push(relativePath);
      emitted[relativePath] = true;
    };

    if (this.firstBuild) {
      // Build initial cache
      this.inputPaths.forEach((dir, index) => this.inputPathsCache[dir] = index);
      treeDiffs.reverse().forEach((treeDiff: DiffResult, index) => {
        index = treeDiffs.length - 1 - index;
        treeDiff.changedPaths.forEach((changedPath) => {
          let cache = this.pathCache[changedPath];
          if (cache === undefined) {
            this.pathCache[changedPath] = [index];
            pathsToEmit.push(changedPath);
          } else if (overwrite) {
            // ASSERT(contains(pathsToEmit, changedPath));
            cache.unshift(index);
          } else {
            throw new Error("`overwrite` option is required for handling duplicates.");
          }
        });
      });
      this.firstBuild = false;
    } else {
      // Update cache
      treeDiffs.reverse().forEach((treeDiff: DiffResult, index) => {
        index = treeDiffs.length - 1 - index;
        treeDiff.removedPaths.forEach((removedPath) => {
          let cache = this.pathCache[removedPath];
          // ASSERT(cache !== undefined);
          // ASSERT(contains(cache, index));
          if (cache[cache.length - 1] === index) {
            pathsToRemove.push(path.join(this.cachePath, removedPath));
            cache.pop();
            if (cache.length === 0) {
              this.pathCache[removedPath] = undefined;
            } else if (!emitted[removedPath]) {
              if (cache.length === 1 && !overwrite) {
                throw new Error("`overwrite` option is required for handling duplicates.");
              }
              emit(removedPath);
            }
          }
        });
        treeDiff.changedPaths.forEach((changedPath) => {
          let cache = this.pathCache[changedPath];
          if (cache === undefined) {
            // File was added
            this.pathCache[changedPath] = [index];
            emit(changedPath);
          } else if (!contains(cache, index)) {
            cache.push(index);
            cache.sort((a, b) => a - b);
            if (cache.length > 1 && !overwrite) {
              throw new Error("`overwrite` option is required for handling duplicates.");
            }
            if (cache[cache.length - 1] === index && !emitted[changedPath]) {
              emit(changedPath);
            }
          }
        });
      });
    }
    let cache: {[key: string]: boolean} = Object.create(null);
    let lstat = (file) => {
      try { return fs.lstatSync(file); } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return undefined;
    }

    let rpath = (file) => {
      let stat;
      let parts = [file];
      while ((stat = lstat(file)) && stat.isSymbolicLink()) {
        file = fs.readlinkSync(file);
        parts.push("  -> " + file);
      }
      if (stat === undefined) parts.push("  -> <dead link>");
      console.log(`[MergeTrees]
${parts.join('\n')}
`);
      return file;
    };

    let exists = (file) => {
      try { return !!fs.statSync(file); }
      catch (e) { if (e.code !== "ENOENT") throw e; }
      return false;
    }

    let remove = (destPath) => {
      let isLink = (filepath) => {
        try {
          return fs.lstatSync(filepath).
              isSymbolicLink();
        } catch (e) { if (e.code !== "ENOENT") throw e; }
        return false;
      }
      let log = true;//destPath.indexOf('change_detection/url_params_to_form.js') > -1;
      if (log && isLink(destPath) && !exists(destPath)) {
        console.log(`[MergeTrees]
  dead symlink ${destPath} (${rpath(destPath)})
`);
          fs.unlinkSync(destPath);
          return;
        }
      if (log) console.log(`[MergeTrees]
  Removing ${destPath}
`);
      let realpath = fs.realpathSync(destPath);
      fs.unlinkSync(destPath);
      if (log && !exists(realpath)) console.log(`[MergeTrees]
  For some reason, ${realpath} was deleted too!
`);
    };

    pathsToRemove.forEach(remove);
    pathsToEmit.forEach((emittedPath) => {
      let log = true;//emittedPath.indexOf('change_detection/url_params_to_form.js') > -1;
      let cache = this.pathCache[emittedPath];
      let destPath = path.join(this.cachePath, emittedPath);
      let sourceIndex = cache[cache.length - 1];
      let sourceInputPath = this.inputPaths[sourceIndex];
      let sourcePath = path.join(sourceInputPath, emittedPath);
      if (this.inputPathsCache[sourceInputPath] !== sourceIndex) {
        throw new Error(`\n[MergeTrees] inputPaths changed.
`);
      }
      if (cache.length > 1) {
        remove(destPath);
      }
      if (log) console.log(`[MergeTrees]
  Outputting ${sourcePath}
    -> ${destPath}
`);
      outputFileSync(sourcePath, destPath, cache);
    });
  }
}

export default wrapDiffingPlugin(MergeTrees);
