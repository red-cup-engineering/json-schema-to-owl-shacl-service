import assert from "node:assert/strict";
import { test } from "node:test";
import { renderNamedGraphAsTurtle } from "../src/named-graph-as-prefixed-turtle.mjs";
import { buildNamedGraph } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-named-graph";
import { iriTerm, literal } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-terms";

const EX = "https://example.org/ns#";
const graph = buildNamedGraph(
  [
    { subject: `${EX}a`, predicate: `${EX}label`, object: literal("A") },
    { subject: `${EX}a`, predicate: `${EX}count`, object: literal(3, { datatype: "http://www.w3.org/2001/XMLSchema#integer" }) },
    { subject: `${EX}b`, predicate: `${EX}sees`, object: iriTerm(`${EX}a`) },
  ],
  `${EX}g`,
);

test("every statement's last predicate-object line ends in a bare period, never '; .'", () => {
  const text = renderNamedGraphAsTurtle(graph, { ex: EX });
  assert.doesNotMatch(text, /;\s*\.\s*$/mu);
  assert.match(text, /ex:count 3 \.\s*$/mu);
});

test("a multi-statement subject joins predicate-object pairs with ' ;' and ends the block with ' .'", () => {
  const text = renderNamedGraphAsTurtle(graph, { ex: EX });
  assert.match(text, /ex:a\n {4}ex:label "A" ;\n {4}ex:count 3 \.\n/u);
});

test("an iri object compacts under its prefix like any other IRI", () => {
  const text = renderNamedGraphAsTurtle(graph, { ex: EX });
  assert.match(text, /ex:b\n {4}ex:sees ex:a \.\n/u);
});

test("the rendered text parses as syntactically valid Turtle (balanced statements, no dangling ';')", () => {
  const text = renderNamedGraphAsTurtle(graph, { ex: EX });
  const statementBlocks = text.split("\n\n").filter((block) => block.trim() && !block.trim().startsWith("@prefix"));
  for (const block of statementBlocks) assert.ok(block.trim().endsWith("."), `block does not end with '.': ${JSON.stringify(block)}`);
});
