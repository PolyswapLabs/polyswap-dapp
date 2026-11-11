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

const ENTRY_POINTS = ["src/backend/listener/index.ts", ...sourceFiles("script")];

test("entry points load .env before any module reads the environment at import time", () => {
  const offenders = ENTRY_POINTS.filter((file) => {
    const source = readFileSync(file, "utf8");
    if (!source.includes("dotenv")) return false;
    return source.match(/^import [^\n]*$/m)?.[0] !== 'import "dotenv/config";';
  });
  assert.deepEqual(offenders, []);
});

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

test("fonts are self-hosted, so a Google Fonts response cannot break dev or the build", () => {
  const offenders = sourceFiles("src").filter((file) =>
    readFileSync(file, "utf8").includes("next/font/google")
  );
  assert.deepEqual(offenders, []);
});
