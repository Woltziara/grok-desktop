import { register } from "node:module";

register(new URL("./resolve-electron-mock.mjs", import.meta.url));
