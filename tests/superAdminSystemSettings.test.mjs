import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getSystemSettingsLoadStatus,
  getSystemSettingsUpdate,
  validateSystemSettings,
} from "../src/utils/systemSettings.js";

const readSource = (path) => readFile(new URL(path, import.meta.url), "utf8");

const validSettings = {
  id: 1,
  system_name: " Kandid ",
  default_election_duration: 2,
  allow_multiple_votes: false,
  allow_abstain: true,
  maintenance_mode: false,
  created_at: "2026-01-01T00:00:00Z",
};

test("settings load results distinguish persisted, missing, and failed reads", () => {
  assert.equal(getSystemSettingsLoadStatus({ data: null, error: null }), "empty");
  assert.equal(getSystemSettingsLoadStatus({ data: null, error: new Error("denied") }), "error");
  assert.equal(getSystemSettingsLoadStatus({ data: validSettings, error: null }), "ready");
});

test("persisted settings are validated without substituting defaults", () => {
  assert.equal(validateSystemSettings(validSettings), null);
  assert.match(validateSystemSettings({ ...validSettings, system_name: "  " }), /system name/i);
  assert.match(validateSystemSettings({ ...validSettings, default_election_duration: 0 }), /whole number/i);
  assert.match(validateSystemSettings({ ...validSettings, allow_abstain: null }), /No default values were substituted/i);
});

test("save payload contains only editable settings fields and preserves stored values", () => {
  assert.deepEqual(getSystemSettingsUpdate(validSettings), {
    system_name: "Kandid",
    default_election_duration: 2,
    allow_multiple_votes: false,
    allow_abstain: true,
    maintenance_mode: false,
  });
});

test("page resolves load failures and missing rows with a working retry state", async () => {
  const page = await readSource("../src/pages/superadmin/SystemSettings.jsx");
  assert.match(page, /useState\("loading"\)/);
  assert.match(page, /\.maybeSingle\(\)/);
  assert.match(page, /\.abortSignal\(controller\.signal\)/);
  assert.match(page, /setTimeout\(\(\) => controller\.abort\(\), 15000\)/);
  assert.match(page, /catch \{/);
  assert.match(page, /setSettingsStatus\(controller\.signal\.aborted \? "timeout" : "error"\)/);
  assert.match(page, /setSettingsStatus\("timeout"\)/);
  assert.match(page, /setSettingsStatus\(status\)/);
  assert.match(page, /System settings are not initialized/);
  assert.match(page, /No persisted settings record with id 1 is visible to this session\. No defaults were created\./);
  assert.match(page, /onClick=\{\(\) => setSettingsRetry\(\(current\) => current \+ 1\)\}/);
  assert.doesNotMatch(page, /\.from\("system_settings"\)\s*\.insert\(/);
  assert.doesNotMatch(page, /\.from\("system_settings"\)\s*\.upsert\(/);
});

test("save reports only confirmed row updates and never sends immutable columns", async () => {
  const page = await readSource("../src/pages/superadmin/SystemSettings.jsx");
  assert.match(page, /\.update\(getSystemSettingsUpdate\(settings\)\)[\s\S]*?\.eq\("id", 1\)[\s\S]*?\.select\("id"\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(page, /if \(!data\) \{\s*prompt\.error\("No settings record was updated\./);
  assert.match(page, /if \(!savedRow\) return;\s*prompt\.success\("Settings saved\."\)/);
});

test("settings remain behind the Super Admin route guard", async () => {
  const app = await readSource("../src/App.jsx");
  assert.match(app, /path="\/super-admin"[\s\S]*?<ProtectedRoute role="super_admin">[\s\S]*?<SuperAdminLayout \/>/);
  assert.match(app, /path="settings"\s+element=\{<SystemSettings \/>\}/);
});
