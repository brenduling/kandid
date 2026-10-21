import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const styles = readFileSync("src/pages/superadmin/Students.css", "utf8");
const modalRule = styles.match(/\.sa-student-details\s*\{([^}]+)\}/)?.[1] ?? "";

test("Student Record modal sets dark text on its light portaled surface", () => {
  assert.match(modalRule, /background:\s*var\(--kandid-app-paper,\s*#fffdf7\)/);
  assert.match(modalRule, /color:\s*var\(--kandid-app-ink,\s*var\(--k-text-primary,\s*#17181c\)\)/);
  assert.match(modalRule, /color-scheme:\s*light/);
});

test("Student Record modal controls inherit the readable foreground", () => {
  const controlsRule = styles.match(/\.sa-student-details button,\s*\.sa-student-details select\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(controlsRule, /color:\s*inherit/);
});

test("Student Record modal keeps its narrow-screen stacked layout", () => {
  assert.match(styles, /@media\s*\(max-width:\s*430px\)[^{]*\{[^}]*\.sa-student-details[^}]*padding:\s*1rem/);
  assert.match(styles, /\.sa-student-details dl\s*\{\s*grid-template-columns:\s*minmax\(0,1fr\)/);
});
