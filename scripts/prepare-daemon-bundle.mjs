import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { build } from "esbuild";

const repositoryRoot = resolve(import.meta.dirname, "..");
const resourceRoot = join(repositoryRoot, "apps", "desktop", "src-tauri", "resources");
const daemonOutput = join(resourceRoot, "daemon", "runlit-daemon.cjs");
const runtimeOutput = join(resourceRoot, "runtime", "node.exe");
const licenseOutput = join(resourceRoot, "runtime", "LICENSE-node.txt");

if (process.platform !== "win32") {
  throw new Error("RunLit currently prepares a bundled daemon runtime only for Windows.");
}

await mkdir(dirname(daemonOutput), { recursive: true });
await mkdir(dirname(runtimeOutput), { recursive: true });
await build({
  entryPoints: [join(repositoryRoot, "apps", "daemon", "src", "index.ts")],
  outfile: daemonOutput,
  bundle: true,
  format: "cjs",
  platform: "node",
  target: "node24",
  define: { "import.meta.url": "undefined" },
  sourcemap: false,
  minify: false,
});

await copyFile(process.execPath, runtimeOutput);
const nodeLicensePath = join(dirname(process.execPath), "LICENSE");
try {
  await copyFile(nodeLicensePath, licenseOutput);
} catch {
  const licenseUrl = `https://raw.githubusercontent.com/nodejs/node/${process.version}/LICENSE`;
  const response = await fetch(licenseUrl);
  if (!response.ok) throw new Error(`Unable to retrieve the Node.js license (${response.status}): ${licenseUrl}`);
  await writeFile(licenseOutput, await response.text(), "utf8");
}

console.log(`Prepared bundled daemon: ${daemonOutput}`);
console.log(`Prepared Node.js runtime: ${runtimeOutput}`);
