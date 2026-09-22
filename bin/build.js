import * as esbuild from "esbuild";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ctxESM, ctxIIFE, ctxCJS, ctxCSS, ctxDemo } from "./configs.js";

// Emptied first, so that what is in dist is what this build produced. A file
// left by an older build — a bundle since renamed, say — would otherwise sit
// there and be published along with the rest. The path is the project's own,
// not the caller's working directory, since this deletes.
rmSync(fileURLToPath(new URL("../dist", import.meta.url)), {
  recursive: true,
  force: true,
});

await ctxESM.rebuild();
await ctxCSS.rebuild();
await ctxIIFE.rebuild();
await ctxCJS.rebuild();
await ctxDemo.rebuild();

console.info("Files built. Available in `dist` folder.");

await ctxESM.dispose();
await ctxCSS.dispose();
await ctxIIFE.dispose();
await ctxCJS.dispose();
await ctxDemo.dispose();
