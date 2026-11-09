import assert from "node:assert/strict";
import { test } from "node:test";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BackLink,
  DefinitionRow,
  ErrorAlert,
  OddsAxis,
} from "../../src/components/primitives/PageBlocks";

// tsx compiles JSX with the classic runtime, which expects a global React.
Object.assign(globalThis, { React });

test("ErrorAlert is announced and lets callers override its spacing", () => {
  const html = renderToStaticMarkup(
    createElement(ErrorAlert, { className: "px-4" } as never, "Failed")
  );
  assert.match(html, /role="alert"/);
  assert.match(html, /px-4/);
  assert.doesNotMatch(html, /px-3/);
  assert.match(html, /Failed/);
});

test("BackLink links to its destination", () => {
  const html = renderToStaticMarkup(createElement(BackLink, { href: "/markets" } as never, "Back"));
  assert.match(html, /href="\/markets"/);
  assert.match(html, /Back/);
});

test("DefinitionRow renders a term and its value", () => {
  const html = renderToStaticMarkup(
    createElement(DefinitionRow, { term: "Trigger", value: "40%" })
  );
  assert.match(html, /<dt[^>]*>Trigger<\/dt>/);
  assert.match(html, /<dd[^>]*>40%<\/dd>/);
});

test("OddsAxis labels the chart from 100% to 0%", () => {
  const labels = [...renderToStaticMarkup(createElement(OddsAxis)).matchAll(/>(\d+%)</g)];
  assert.deepEqual(
    labels.map((match) => match[1]),
    ["100%", "75%", "50%", "25%", "0%"]
  );
});
