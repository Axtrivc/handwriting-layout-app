import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tests = [
  "test_document.mjs",
  "test_editing.mjs",
  "test_project_files.mjs",
  "test_project_assets.mjs",
  "test_export_history.mjs",
  "test_multipage.mjs",
  "test_image_cache.mjs",
  "test_viewport.mjs",
  "test_api_client.mjs",
  "test_natural_handwriting.mjs",
  "test_text_flow.mjs",
  "test_scan_geometry.mjs",
  "test_ocr_lazy.mjs",
  "test_sampling.mjs",
  "test_release.mjs",
];

for (const test of tests) {
  console.log(`\n>>> ${test}`);
  const result = spawnSync(process.execPath, [resolve(root, "scripts", test)], {
    cwd: root,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.log(`\nPASS: ${tests.length} unit/regression suites completed`);
