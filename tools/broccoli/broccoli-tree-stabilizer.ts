/// <reference path="broccoli.d.ts" />
/// <reference path="../typings/node/node.d.ts" />

import fs = require('fs');
import fse = require('fs-extra');
let symlinkOrCopy = require('symlink-or-copy');


/**
 * Stabilizes the inputPath for the following plugins in the build tree.
 *
 * All broccoli plugins that inherit from `broccoli-writer` or `broccoli-filter` change their
 * outputPath during each rebuild.
 *
 * This means that all following plugins in the build tree can't rely on their inputPath being
 * immutable. This results in breakage of any plugin that is not expecting such behavior.
 *
 * For example all `DiffingBroccoliPlugin`s expect their inputPath to be stable.
 *
 * By inserting this plugin into the tree after any misbehaving plugin, we can stabilize the
 * inputPath for the following plugin in the tree and correct the surprising behavior.
 */
class TreeStabilizer implements BroccoliTree {
  inputPath: string;
  outputPath: string;


  constructor(public inputTree: BroccoliTree) {}


  rebuild() {
    let isDirectory = (filepath) => {
      try {
        let lstat = fs.lstatSync(filepath);
        if (lstat.isDirectory()) return true;
        let stat = fs.statSync(filepath);
        if (stat.isDirectory()) return true;
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      return false;
    };
    let isLink = (filepath) => {
      try {
        return fs.lstatSync(filepath).isSymbolicLink();
      } catch (e) {}
      return false;
    };
    if (isLink(this.inputPath)) {
      console.log(`[TreeStabilizer]
  ${this.inputPath}
    -> ${fs.realpathSync(this.inputPath)}
`);
    }
    if (!isDirectory(this.inputPath)) {
      console.log(`[TreeStabilizer]
  ${this.inputPath} is not a directory
`);
    } else {
    console.log(`[TreeStabilizer]
  removing ${this.outputPath}
`);
    }
    fse.removeSync(this.outputPath);

    // TODO: investigate if we can use rename the directory instead to improve performance on
    // Windows
    console.log(`[TreeStabilizer] Copying
  ${this.inputPath}
    -> ${this.outputPath}
`);
    symlinkOrCopy.sync(this.inputPath, this.outputPath);
    //fse.copySync(this.inputPath, this.outputPath);
  }


  cleanup() {}
}


export default function stabilizeTree(inputTree) {
  return new TreeStabilizer(inputTree);
}
