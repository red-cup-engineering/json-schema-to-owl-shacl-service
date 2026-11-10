import assert from "node:assert/strict";
import test from "node:test";
import { buildOwlOntology } from "@red-cup-engineering/json-schema-to-owl-shacl-service";

test("SCHEMA-ONTOLOGY-QUICKSTART", () => {
  const result = buildOwlOntology([{
    id: "widget", filePath: "/schemas/widget.schema.json",
    schema: { $id: "widget", title: "Widget", type: "object", properties: { name: { type: "string" } } },
  }], { baseIri: "https://example.org/schema/", graphName: "https://example.org/graph" });
  assert.equal(result.classIriById.has("widget"), true);
});
