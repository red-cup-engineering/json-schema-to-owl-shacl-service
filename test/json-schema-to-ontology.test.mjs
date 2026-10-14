import assert from "node:assert/strict";
import { test } from "node:test";
import { buildOwlOntology, buildShaclShapes } from "../src/json-schema-to-ontology.mjs";

const BASE_IRI = "https://example.org/ns/schema/";

const widgetEntry = {
  id: "widgets/widget",
  filePath: "/schemas/widget.schema.json",
  schema: {
    $id: "widgets/widget",
    title: "widget",
    description: "A thing with a name and one owner.",
    type: "object",
    required: ["name", "owner"],
    properties: {
      name: { type: "string", description: "the widget's name" },
      status: { type: "string", enum: ["draft", "released"] },
      owner: { $ref: "./owner.schema.json" },
      tags: { type: "array", items: { type: "string" } },
    },
  },
};

const ownerEntry = {
  id: "widgets/owner",
  filePath: "/schemas/owner.schema.json",
  schema: {
    $id: "widgets/owner",
    title: "owner",
    type: "object",
    required: ["email"],
    properties: { email: { type: "string" } },
  },
};

const thinWrapperEntry = {
  id: "widgets/released-widget",
  filePath: "/schemas/released-widget.schema.json",
  schema: { $id: "widgets/released-widget", allOf: [{ $ref: "./widget.schema.json" }, { properties: { status: { const: "released" } } }] },
};

test("mints an owl:Class only for schemas with their own properties", () => {
  const { classIriById } = buildOwlOntology([widgetEntry, ownerEntry, thinWrapperEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" });
  assert.deepEqual([...classIriById.keys()].sort(), ["widgets/owner", "widgets/widget"]);
});

test("emits a DatatypeProperty with the mapped xsd range for a string property", () => {
  const { namedGraph } = buildOwlOntology([widgetEntry, ownerEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" });
  const nameTypeQuad = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widget#name` && q.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  assert.equal(nameTypeQuad.object.value, "http://www.w3.org/2002/07/owl#DatatypeProperty");
  const rangeQuad = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widget#name` && q.predicate === "http://www.w3.org/2000/01/rdf-schema#range");
  assert.equal(rangeQuad.object.value, "http://www.w3.org/2001/XMLSchema#string");
});

test("emits an ObjectProperty resolving a $ref to the referenced schema's class IRI", () => {
  const { namedGraph } = buildOwlOntology([widgetEntry, ownerEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" });
  const ownerTypeQuad = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widget#owner` && q.predicate === "http://www.w3.org/1999/02/22-rdf-syntax-ns#type");
  assert.equal(ownerTypeQuad.object.value, "http://www.w3.org/2002/07/owl#ObjectProperty");
  const rangeQuad = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widget#owner` && q.predicate === "http://www.w3.org/2000/01/rdf-schema#range");
  assert.equal(rangeQuad.object.value, `${BASE_IRI}widgets/owner`);
});

test("refuses a $ref that does not resolve to a supplied class-defining entry", () => {
  assert.throws(() => buildOwlOntology([widgetEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" }), /does not resolve|defines no owl:Class/);
});

test("shapes: required property gets minCount 1 and Violation severity; optional gets Warning and no minCount", () => {
  const { namedGraph } = buildShaclShapes([widgetEntry, ownerEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" });
  const nameShape = `${BASE_IRI}widgets/widgetShape/name`;
  const statusShape = `${BASE_IRI}widgets/widgetShape/status`;
  const nameMinCount = namedGraph.quads.find((q) => q.subject === nameShape && q.predicate === "http://www.w3.org/ns/shacl#minCount");
  const nameSeverity = namedGraph.quads.find((q) => q.subject === nameShape && q.predicate === "http://www.w3.org/ns/shacl#severity");
  assert.equal(nameMinCount.object.value, "1");
  assert.equal(nameSeverity.object.value, "http://www.w3.org/ns/shacl#Violation");
  const statusMinCount = namedGraph.quads.find((q) => q.subject === statusShape && q.predicate === "http://www.w3.org/ns/shacl#minCount");
  const statusSeverity = namedGraph.quads.find((q) => q.subject === statusShape && q.predicate === "http://www.w3.org/ns/shacl#severity");
  assert.equal(statusMinCount, undefined);
  assert.equal(statusSeverity.object.value, "http://www.w3.org/ns/shacl#Violation");
});

test("shapes: an enum becomes an sh:pattern regex alternation, not a blank-node sh:in list", () => {
  const { namedGraph } = buildShaclShapes([widgetEntry, ownerEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" });
  const statusPattern = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widgetShape/status` && q.predicate === "http://www.w3.org/ns/shacl#pattern");
  assert.equal(statusPattern.object.value, "^(draft|released)$");
  const inQuad = namedGraph.quads.find((q) => q.predicate === "http://www.w3.org/ns/shacl#in");
  assert.equal(inQuad, undefined);
});

test("shapes: an array-of-string property gets no maxCount (repeatable)", () => {
  const { namedGraph } = buildShaclShapes([widgetEntry, ownerEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" });
  const tagsMaxCount = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widgetShape/tags` && q.predicate === "http://www.w3.org/ns/shacl#maxCount");
  assert.equal(tagsMaxCount, undefined);
});

test("shapes: a $ref object property gets sh:class, not sh:datatype", () => {
  const { namedGraph } = buildShaclShapes([widgetEntry, ownerEntry], { baseIri: BASE_IRI, graphName: "https://example.org/g" });
  const ownerClass = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widgetShape/owner` && q.predicate === "http://www.w3.org/ns/shacl#class");
  assert.equal(ownerClass.object.value, `${BASE_IRI}widgets/owner`);
  const ownerDatatype = namedGraph.quads.find((q) => q.subject === `${BASE_IRI}widgets/widgetShape/owner` && q.predicate === "http://www.w3.org/ns/shacl#datatype");
  assert.equal(ownerDatatype, undefined);
});

const termReference = {
  id: "glossary/terms/term",
  filePath: "/elsewhere/term.schema.json",
  baseIri: "https://example.org/terms/",
  schema: {
    $id: "glossary/terms/term",
    type: "object",
    properties: {
      aliases: { type: "array", description: "other names", items: { type: "string" } },
      keywords: { type: "array", items: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" } },
    },
  },
};

const noteEntry = {
  id: "carriers/note",
  filePath: "/schemas/note.schema.json",
  schema: {
    $id: "carriers/note",
    type: "object",
    required: ["title"],
    properties: {
      title: { type: "string" },
      aliases: { $ref: "../glossary/terms/term#/properties/aliases" },
      keywords: { $ref: "glossary/terms/term#/properties/keywords", description: "the note's own words" },
      kin: { $ref: "../glossary/terms/term" },
    },
  },
};

const quadsOf = (namedGraph, subject, predicate) => namedGraph.quads.filter((q) => q.subject === subject && q.predicate === predicate).map((q) => q.object.value);

test("a $ref by $id with a JSON Pointer fragment reuses that subschema in place, from a reference that mints nothing", () => {
  const options = { baseIri: BASE_IRI, graphName: "https://example.org/g", references: [termReference] };
  const { classIriById, namedGraph } = buildOwlOntology([noteEntry], options);
  assert.deepEqual([...classIriById.keys()], ["carriers/note"], "the reference is resolved, not minted");
  assert.deepEqual(quadsOf(namedGraph, `${BASE_IRI}carriers/note#aliases`, "http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), ["http://www.w3.org/2002/07/owl#DatatypeProperty"]);
  assert.deepEqual(quadsOf(namedGraph, `${BASE_IRI}carriers/note#aliases`, "http://www.w3.org/2000/01/rdf-schema#comment"), ["other names"]);
  assert.deepEqual(quadsOf(namedGraph, `${BASE_IRI}carriers/note#keywords`, "http://www.w3.org/2000/01/rdf-schema#comment"), ["the note's own words"], "the referring description wins");
  assert.deepEqual(quadsOf(namedGraph, `${BASE_IRI}carriers/note#kin`, "http://www.w3.org/2000/01/rdf-schema#range"), ["https://example.org/terms/glossary/terms/term"], "a root reference ranges over the class at its authority's IRI");
  const shapes = buildShaclShapes([noteEntry], options).namedGraph;
  assert.deepEqual(quadsOf(shapes, `${BASE_IRI}carriers/noteShape/keywords`, "http://www.w3.org/ns/shacl#pattern"), ["^[a-z0-9]+(?:-[a-z0-9]+)*$"], "the reused subschema's pattern constrains");
  assert.deepEqual(quadsOf(shapes, `${BASE_IRI}carriers/noteShape/aliases`, "http://www.w3.org/ns/shacl#maxCount"), [], "the reused array stays repeatable");
});

test("refuses a JSON Pointer that names no subschema", () => {
  const broken = { ...noteEntry, schema: { ...noteEntry.schema, properties: { lost: { $ref: "../glossary/terms/term#/properties/nothing" } } } };
  assert.throws(() => buildOwlOntology([broken], { baseIri: BASE_IRI, graphName: "https://example.org/g", references: [termReference] }), /names no subschema/u);
});


test("property enum metacharacters are literal in the generated SHACL pattern", () => {
  const special = {
    ...widgetEntry,
    schema: {
      ...widgetEntry.schema,
      properties: {
        ...widgetEntry.schema.properties,
        status: {type: "string", enum: ["alpha.beta", "x|y", "a+b?", "[test]"]},
      },
    },
  };
  const {namedGraph} = buildShaclShapes([special, ownerEntry], {
    baseIri: BASE_IRI, graphName: "https://example.org/g",
  });
  const entry = namedGraph.quads.find(q => q.subject ===
    BASE_IRI + "widgets/widgetShape/status" &&
    q.predicate === "http://www.w3.org/ns/shacl#pattern");
  assert.ok(entry);
  const re = new RegExp(entry.object.value);
  for (const value of special.schema.properties.status.enum) assert.equal(re.test(value), true);
  for (const impostor of ["alphaXbeta", "xx", "ab", "tests"]) assert.equal(re.test(impostor), false);
});

test("SHACL projection refuses disjunction and closed records it cannot faithfully validate", () => {
  const duty = {
    id: "institutional/duty",
    filePath: "/schemas/duty.schema.json",
    schema: {
      $id: "institutional/duty", type: "object",
      required: ["name", "authority", "claim"],
      anyOf: [{required: ["work"]}, {required: ["from", "to"]}],
      properties: {
        name: {type:"string"}, authority:{type:"string"}, claim:{type:"string"},
        work:{type:"string"}, from:{type:"string"}, to:{type:"string"},
      },
    },
  };
  const options = {baseIri: BASE_IRI, graphName: "https://example.org/g"};
  assert.throws(() => buildShaclShapes([duty], options), /unsupported JSON Schema constraint anyOf/u);
  const open = {...duty, schema:{...duty.schema}};
  delete open.schema.anyOf;
  open.schema.additionalProperties = false;
  assert.throws(() => buildShaclShapes([open], options), /additionalProperties/u);
});

test("SHACL refuses silent loss of nested or otherwise unsupported property constraints", () => {
  const options = {baseIri: BASE_IRI, graphName: "https://example.org/g"};
  const nested = {...ownerEntry, schema:{
    ...ownerEntry.schema,
    properties: {details:{type:"object",properties:{issuedBy:{type:"string"}}}},
  }};
  assert.throws(() => buildShaclShapes([nested], options), /unsupported properties/u);
  const conditional = {...ownerEntry, schema:{
    ...ownerEntry.schema,
    properties: {email:{type:"string",minLength:2}},
  }};
  assert.throws(() => buildShaclShapes([conditional], options), /unsupported minLength/u);
  const undefinedRequired = {...ownerEntry, schema:{
    ...ownerEntry.schema,
    required: ["missing"],
  }};
  assert.throws(() => buildShaclShapes([undefinedRequired], options), /requires undeclared property/u);
});

test("nested arrays, local references and referenced classes are checked recursively", () => {
  const options = {baseIri: BASE_IRI, graphName: "https://example.org/g"};
  const nested = {...widgetEntry, schema: {...widgetEntry.schema,
    properties: {name: {type:"array", items:{type:"string",minLength:5}}}}};
  assert.throws(() => buildShaclShapes([nested], options), /unsupported minLength/u);

  const hidden = {...widgetEntry, schema: {...widgetEntry.schema,
    properties: {name: {$ref: "#/properties/status"},status:{type:"string",minLength:2}}}};
  assert.throws(() => buildShaclShapes([hidden], options), /reference uses unsupported minLength/u);

  const cyclic = {...widgetEntry, schema: {...widgetEntry.schema,
    properties: {name: {$ref: "#/properties/name"}}}};
  assert.throws(() => buildShaclShapes([cyclic], options), /cyclic SHACL property reference/u);

  const nonStringEnum = {...widgetEntry, schema: {...widgetEntry.schema,
    properties: {name: {type:"integer",enum:[1,2]}}}};
  assert.throws(() => buildShaclShapes([nonStringEnum], options), /exact enum representation/u);

  const modifiedOwner = {...ownerEntry, schema: {...ownerEntry.schema,
    additionalProperties: false}};
  assert.throws(() => buildShaclShapes([widgetEntry,modifiedOwner], options), /additionalProperties/u);
});
