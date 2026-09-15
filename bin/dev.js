import * as esbuild from "esbuild";
import { ctxESM, ctxIIFE, ctxCJS, ctxCSS, ctxDemo } from "./configs.js";

await ctxESM.watch();
await ctxCSS.watch();
await ctxIIFE.watch();
await ctxCJS.watch();
await ctxDemo.watch();

let { hosts, port } = await ctxESM.serve({
  servedir: "dist",
});

console.info(`Serving on http://localhost:${port}`);
