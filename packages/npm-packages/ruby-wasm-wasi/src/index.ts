export { consolePrinter } from "./console.js";
export * from "./vm.js";

import { main } from "./browser.script";
main({name: "ruby-wasm-wasi-poc", version: "0.1.0", url: "./ruby.wasm"});
