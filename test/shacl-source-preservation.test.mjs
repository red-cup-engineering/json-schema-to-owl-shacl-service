import assert from "node:assert/strict";
import test from "node:test";
import { buildOwlOntology, buildShaclShapes } from "../src/json-schema-to-ontology.mjs";

const graph = { baseIri: "https://example.org/institution/", graphName: "https://example.org/institution/shapes" };
const entry = (id, schema, filePath = "/schemas/main.schema.json") => ({ id, filePath, schema: { $id: id, ...schema } });
const primitive = () => entry("enterprise/customer", { type: "object",
  required: ["name"], properties: { name: { type: "string" }, notes: { type: "string" } },
});

test("ordinary required scalar still has minCount 1 and optional scalar has no minimum", () => {
  const { namedGraph } = buildShaclShapes([primitive()], graph);
  const min = namedGraph.quads.filter(q => q.predicate.endsWith("#minCount"));
  assert.equal(min.length, 1);
  assert.ok(min[0].subject.endsWith("/name"));
  assert.equal(min[0].object.value, "1");
});

test("required ordinary array refuses rather than rejecting a JSON-valid empty array", () => {
  const schema = entry("enterprise/customer", { type: "object",
    required: ["contacts"], properties: { contacts: { type: "array", items: { type: "string" } } },
  });
  assert.deepEqual({ contacts: [] }.contacts, [],
    "JSON Schema required means presence of the property, not a nonempty array");
  assert.throws(() => buildShaclShapes([schema], graph), /required array contacts.*empty-array presence/u);
  // The informational OWL relation remains expressible as a datatype property;
  // SHACL never claims its generated shapes validate this schema.
  const owl = buildOwlOntology([schema], graph);
  assert.ok(owl.namedGraph.quads.some(q => q.subject.endsWith("#contacts")));
});

test("required array through an original JSON Pointer reference is equally refused", () => {
  const schema = entry("enterprise/customer", {
    type: "object", required: ["tags"],
    properties: {
      labels: { type: "array", items: { type: "string" } },
      tags: { $ref: "#/properties/labels" },
    },
  });
  assert.throws(() => buildShaclShapes([schema], graph), /required array tags.*empty-array presence/u);
});

test("optional repeated values remain supported with no false minCount or maxCount", () => {
  const schema = entry("enterprise/customer", { type: "object",
    properties: { tags: { type: "array", items: { type: "string" } } },
  });
  const { namedGraph } = buildShaclShapes([schema], graph);
  const shape = namedGraph.quads.filter(q => q.subject.endsWith("/tags"));
  assert.equal(shape.some(q => q.predicate.endsWith("#minCount")), false);
  assert.equal(shape.some(q => q.predicate.endsWith("#maxCount")), false);
  assert.equal(shape.find(q => q.predicate.endsWith("#datatype")).object.value,
    "http://www.w3.org/2001/XMLSchema#string");
});

test("JSON Schema 2020-12 required is an array of unique string names, not coercible source", () => {
  for (const required of ["name", [true], ["name", "name"], [42], null, {name: true}]) {
    const schema = entry("enterprise/customer", { type: "object", required,
      properties: { name: { type: "string" } },
    });
    if (required === null) {
      // A present null is not an omitted keyword either.
      assert.throws(() => buildShaclShapes([schema], graph), /required.*unique string/u);
    } else {
      assert.throws(() => buildShaclShapes([schema], graph), /required.*unique string/u);
    }
  }
  const legalEmpty = entry("enterprise/customer", { type: "object",
    required: [], properties: { name: { type: "string" } },
  });
  assert.equal(buildShaclShapes([legalEmpty], graph).namedGraph.quads.some(
    q => q.predicate.endsWith("#minCount")), false);
});

test("duplicate schema logical IDs or file paths refuse cross-tenant source collisions", () => {
  const a = primitive();
  const sameId = { ...primitive(), filePath: "/other/customer.schema.json" };
  const sameFile = { ...primitive(), id: "enterprise/account" };
  for (const other of [sameId, sameFile]) {
    assert.throws(() => buildShaclShapes([a, other], graph), /duplicate schema identity/u);
    assert.throws(() => buildOwlOntology([a, other], graph), /duplicate schema identity/u);
  }
  assert.throws(() => buildShaclShapes([a], {
    ...graph, references: [sameId],
  }), /duplicate schema identity/u);
});

test("malformed root properties and object declarations cannot disappear as an empty schema projection", () => {
  for (const properties of [null, ["not", "an", "object"], false, 5]) {
    const malformed = entry("enterprise/customer", { type: "object", properties });
    assert.throws(() => buildShaclShapes([malformed], graph), /invalid properties/u);
    assert.throws(() => buildOwlOntology([malformed], graph), /invalid properties/u);
  }
});
