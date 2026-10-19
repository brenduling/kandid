import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = await readFile(
  new URL("../src/components/ScheduleDateTimePicker.jsx", import.meta.url),
  "utf8",
);

test("opening one schedule picker dispatches outside React state updater", () => {
  const toggle = component.match(/function toggleOpen\(\) \{([\s\S]*?)\n  \}/)?.[1];

  assert.ok(toggle, "schedule picker toggle handler exists");
  assert.match(toggle, /const nextOpen = !open;/);
  assert.ok(
    toggle.indexOf("document.dispatchEvent(") < toggle.indexOf("setOpen(nextOpen)"),
    "notify sibling pickers before setting this picker state",
  );
  assert.doesNotMatch(toggle, /setOpen\s*\(\s*\(current\)/);
});
