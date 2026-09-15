import * as esbuild from "esbuild";

import { ctxESM, ctxIIFE, ctxCJS, ctxCSS, ctxDemo } from "./configs.js";

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
