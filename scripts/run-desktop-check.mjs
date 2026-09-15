import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import path from "node:path";
const electron = createRequire(import.meta.url)("electron");
const fixture = process.argv[2];
if (!fixture || !/^test\/electron\/[a-z-]+\.mjs$/.test(fixture)) throw new Error("Expected a named desktop test fixture");
const args = [...(process.platform === "linux" && process.getuid?.() === 0 ? ["--no-sandbox"] : []), path.resolve(fixture)];
const xvfb = process.platform === "linux" && !process.env.DISPLAY;
const result = spawnSync(xvfb ? "xvfb-run" : electron, xvfb ? ["-a", electron, ...args] : args, {
  encoding: "utf8", timeout: 90_000, killSignal: "SIGKILL",
});
process.stdout.write(result.stdout || ""); process.stderr.write(result.stderr || "");
if (result.error) console.error(result.error.message);
process.exitCode = result.status === 0 && /"ok"\s*:\s*true/.test(result.stdout || "") ? 0 : 1;
