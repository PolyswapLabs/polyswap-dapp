import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const tsxFiles = readdirSync("src", { recursive: true, encoding: "utf8" })
  .filter((file) => file.endsWith(".tsx"))
  .map((file) => join("src", file));

test("a Link never wraps a Button, which would nest a button inside an anchor", () => {
  const offenders = tsxFiles.filter((file) =>
    /<Link\b[^>]*>\s*<Button\b/.test(readFileSync(file, "utf8"))
  );
  assert.deepEqual(offenders, []);
});
