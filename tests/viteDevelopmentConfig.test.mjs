import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("normal Vite development binds strictly to localhost:5174 and keeps the inspection port separate", async () => {
  const source = await readFile(new URL("../vite.config.js", import.meta.url), "utf8");
  assert.match(source, /mode === "development"[\s\S]*?host: "localhost", port: 5174, strictPort: true/);
  assert.match(source, /localProductionReadonly[\s\S]*?host: "localhost", port: 5173, strictPort: true/);
  assert.match(source, /validateSupabaseBuildEnvironment\(mode, env\)/);
});
