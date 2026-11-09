import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const sourceFiles = (dir: string) =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => join(dir, file));

const VALUE_IMPORT = /^import (?!type\b)[^;]*?from "(@\/[^"]+)";/gms;

const valueImports = (file: string) =>
  [...readFileSync(file, "utf8").matchAll(VALUE_IMPORT)].map((match) => match[1] as string);

test("shared code only depends on shared code, so the listener image stays self-contained", () => {
  const offenders = sourceFiles("src/shared").flatMap((file) =>
    valueImports(file)
      .filter((spec) => !spec.startsWith("@/shared/"))
      .map((spec) => `${file} -> ${spec}`)
  );
  assert.deepEqual(offenders, []);
});

test("backend code only reaches shared, backend and ABI modules at runtime", () => {
  const offenders = sourceFiles("src/backend").flatMap((file) =>
    valueImports(file)
      .filter((spec) => !/^@\/(shared|backend|abi)\//.test(spec))
      .map((spec) => `${file} -> ${spec}`)
  );
  assert.deepEqual(offenders, []);
});
