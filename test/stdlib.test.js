// The plugin ships with no node_modules: everything it loads must be a Node built-in.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { builtinModules } = require("node:module");

const PLUGIN_DIR = path.join(__dirname, "..", "dev.countdown.sdPlugin");

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(p);
    return e.name.endsWith(".js") ? [p] : [];
  });
}

test("the plugin imports only the Node standard library", () => {
  const specifiers = [];
  for (const file of jsFiles(PLUGIN_DIR)) {
    const src = fs.readFileSync(file, "utf8");
    for (const m of src.matchAll(/\brequire\(\s*["'`]([^"'`]+)["'`]\s*\)|\bfrom\s+["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']/g)) {
      specifiers.push({ file: path.relative(PLUGIN_DIR, file), spec: m[1] || m[2] || m[3] });
    }
  }
  assert.ok(specifiers.length > 0, "found the plugin's imports");
  for (const { file, spec } of specifiers) {
    assert.ok(spec.startsWith("node:"), `${file}: "${spec}" must use the node: prefix`);
    assert.ok(builtinModules.includes(spec.slice(5)), `${file}: "${spec}" is not a Node built-in`);
  }
});

test("the plugin folder has no node_modules or package.json", () => {
  assert.equal(fs.existsSync(path.join(PLUGIN_DIR, "node_modules")), false);
  assert.equal(fs.existsSync(path.join(PLUGIN_DIR, "package.json")), false);
});
