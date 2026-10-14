// json-schema-to-ontology — mechanically derives an OWL class model and
// SHACL validation shapes from a set of JSON Schema (draft 2020-12) files,
// so a schema stays the one authored, canonical source and its RDF/OWL/
// SHACL projection is generated, never hand-duplicated. Built on this
// section's own RDF primitives (`rdf-term-construction-service`,
// `rdf-named-graph-construction-service`) rather than hand-formatted
// template strings.
//
// Rule: a schema file mints an owl:Class only when it declares its own
// `properties` object. A schema that only wraps another via `allOf`/`$ref`
// (this house's own per-term thin schemas, e.g. dao.schema.json fixing
// `term: {const: "dao"}` over translation-variance-record.schema.json)
// names an instance of the wrapped class, not a second class — so no
// class, property, or shape is emitted for it. This is a mechanical
// consequence of the rule, not a per-file exception.
import { iriTerm, literal } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-terms";
import { buildNamedGraph } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-named-graph";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const SH = "http://www.w3.org/ns/shacl#";

const XSD_BY_JSON_SCHEMA_TYPE = Object.freeze({
  string: `${XSD}string`,
  integer: `${XSD}integer`,
  number: `${XSD}decimal`,
  boolean: `${XSD}boolean`,
});

function fail(message) {
  throw new Error(message);
}

/** True for a schema this generator mints a class for: it declares its own `properties`. */
function definesOwnClass(schema) {
  return schema?.type === "object" && schema.properties !== undefined && typeof schema.properties === "object";
}

/** The subschema a JSON Pointer fragment (`/properties/aliases`) names inside `schema`. */
function atPointer(schema, fragment) {
  return fragment.split("/").slice(1).map((token) => decodeURIComponent(token).replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((node, token) => (node === undefined || node === null ? undefined : node[token]), schema);
}

/**
 * Resolves `$ref`s the way JSON Schema does and describes each property in the one shape this
 * module's two builders need. A `$ref` names its target by retrieval path (relative to the
 * referring file), else by `$id` as the house validator reads one: the bare address first, then
 * resolved against the referring schema's `$id`. A bare reference to a
 * class-defining schema is an object property ranging over that class; a reference with a JSON
 * Pointer fragment reuses that subschema, so it is described as if written in place.
 *
 * `references` are schemas another authority holds (a term schema a note schema borrows from):
 * they resolve `$ref`s but mint nothing here, and a class one defines keeps its own `baseIri`.
 * @param {Array<{id: string, filePath: string, schema: object}>} entries
 * @param {string} baseIri
 * @param {Array<{id: string, filePath: string, schema: object, baseIri?: string}>} [references]
 */
function index(entries, baseIri, references = []) {
  const all = [...entries, ...references];
  const byFilePath = new Map(all.map((entry) => [entry.filePath, entry]));
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const classIriById = new Map(entries.filter((entry) => definesOwnClass(entry.schema)).map((entry) => [entry.id, `${baseIri}${entry.id}`]));
  const rangeIriById = new Map([
    ...references.filter((entry) => definesOwnClass(entry.schema)).map((entry) => [entry.id, `${entry.baseIri ?? baseIri}${entry.id}`]),
    ...classIriById,
  ]);

  function target(fromEntry, ref) {
    const at = ref.indexOf("#");
    const address = at === -1 ? ref : ref.slice(0, at);
    const fragment = at === -1 ? "" : ref.slice(at + 1);
    if (address === "") return { entry: fromEntry, fragment };
    const entry = byFilePath.get(decodeURIComponent(new URL(address, `file://${fromEntry.filePath}`).pathname))
      ?? byId.get(address)
      ?? byId.get(decodeURIComponent(new URL(address, `https://schema.invalid/${fromEntry.id}`).pathname.slice(1)));
    if (!entry) fail(`$ref ${JSON.stringify(ref)} from ${fromEntry.filePath} does not resolve to a supplied schema entry`);
    return { entry, fragment };
  }

  /** @returns {{kind: "object"|"datatype"|"unsupported", range?: string, xsd?: string, repeatable?: boolean, enum?: unknown[], pattern?: string, description?: string}} */
  function describe(fromEntry, propertySchema) {
    const description = propertySchema.description;
    if (propertySchema.$ref !== undefined) {
      const { entry, fragment } = target(fromEntry, propertySchema.$ref);
      if (fragment === "") {
        const range = rangeIriById.get(entry.id);
        if (!range) fail(`$ref ${JSON.stringify(propertySchema.$ref)} resolves to ${entry.id}, which defines no owl:Class (no own properties)`);
        return { kind: "object", range, repeatable: false, description };
      }
      const reused = atPointer(entry.schema, fragment);
      if (reused === undefined || reused === null || typeof reused !== "object") fail(`$ref ${JSON.stringify(propertySchema.$ref)} from ${fromEntry.filePath} names no subschema of ${entry.id}`);
      const described = describe(entry, reused);
      return { ...described, description: description ?? described.description };
    }
    if (propertySchema.type === "array" && propertySchema.items !== undefined) {
      const item = describe(fromEntry, propertySchema.items);
      if (item.kind === "unsupported" || item.repeatable) return { kind: "unsupported" };
      return { ...item, repeatable: true, description };
    }
    if (XSD_BY_JSON_SCHEMA_TYPE[propertySchema.type] !== undefined) {
      return { kind: "datatype", xsd: XSD_BY_JSON_SCHEMA_TYPE[propertySchema.type], repeatable: false, enum: propertySchema.enum, pattern: propertySchema.pattern, description };
    }
    return { kind: "unsupported" };
  }

  return { classIriById, describe };
}

/**
 * Builds the OWL ontology named graph for a set of JSON Schema entries.
 * @param {Array<{id: string, filePath: string, schema: object}>} entries
 * @param {{baseIri: string, graphName: string}} options
 */
export function buildOwlOntology(entries, { baseIri, graphName, references = [] }) {
  const { classIriById, describe } = index(entries, baseIri, references);
  const statements = [];
  const assert = (subject, predicate, object) => statements.push({ subject, predicate, object });

  for (const entry of entries) {
    if (!definesOwnClass(entry.schema)) continue;
    const classIri = classIriById.get(entry.id);
    assert(classIri, `${RDF}type`, iriTerm(`${OWL}Class`));
    assert(classIri, `${RDFS}label`, literal(entry.schema.title ?? entry.id.split("/").at(-1)));
    if (entry.schema.description) assert(classIri, `${RDFS}comment`, literal(entry.schema.description));

    for (const [propertyName, propertySchema] of Object.entries(entry.schema.properties)) {
      const propertyIri = `${classIri}#${propertyName}`;
      const described = describe(entry, propertySchema);
      if (described.kind === "unsupported") continue;
      assert(propertyIri, `${RDF}type`, iriTerm(`${OWL}${described.kind === "object" ? "Object" : "Datatype"}Property`));
      assert(propertyIri, `${RDFS}domain`, iriTerm(classIri));
      if (described.description) assert(propertyIri, `${RDFS}comment`, literal(described.description));
      if (described.kind === "object") {
        assert(propertyIri, `${RDFS}range`, iriTerm(described.range));
      } else {
        assert(propertyIri, `${RDFS}range`, iriTerm(described.xsd));
      }
    }
  }

  return { namedGraph: buildNamedGraph(statements, graphName), classIriById };
}

/** Keep a JSON Schema enum's lexical values literal under sh:pattern. */
function literalPattern(value) {
  const reserved = new Set(["\\", ".", "+", "*", "?", "^", "$", "{", "}", "(", ")", "[", "]", "|"]);
  return [...String(value)].map(character => reserved.has(character) ? "\\" + character : character).join("");
}

/** Refuse a schema when SHACL would silently omit a load-bearing constraint. */
function requireShaclSubset(entry) {
  const schema = entry.schema;
  for (const key of ["anyOf", "oneOf", "allOf", "not", "if", "then", "else",
    "dependentRequired", "dependentSchemas", "patternProperties",
    "propertyNames", "minProperties", "maxProperties", "unevaluatedProperties"]) {
    if (Object.hasOwn(schema, key)) fail(`${entry.id} uses unsupported JSON Schema constraint ${key}: refusing incomplete SHACL validation`);
  }
  if (Object.hasOwn(schema, "additionalProperties") && schema.additionalProperties !== true) {
    fail(`${entry.id} requires unimplemented additionalProperties handling: refusing incomplete SHACL validation`);
  }
  const properties = schema.properties;
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(properties, required)) fail(`${entry.id} requires undeclared property ${required}`);
  }
  const supportedPropertyKeys = new Set(["type", "$ref", "description", "title", "default",
    "examples", "$comment", "enum", "pattern", "items"]);
  for (const [name, property] of Object.entries(properties)) {
    for (const key of Object.keys(property)) {
      if (!supportedPropertyKeys.has(key)) {
        fail(`${entry.id} property ${name} uses unsupported ${key}: refusing incomplete SHACL validation`);
      }
    }
  }
}

/**
 * Builds the SHACL shapes named graph for the same schema entries: one
 * sh:NodeShape per class, named (not blank-node) sh:property shapes to
 * stay inside this section's own no-blank-node RDF term rule, and an
 * enum encoded as sh:pattern (a regex alternation) rather than an
 * sh:in RDF list, for the same reason.
 * @param {Array<{id: string, filePath: string, schema: object}>} entries
 * @param {{baseIri: string, graphName: string}} options
 */
export function buildShaclShapes(entries, { baseIri, graphName, references = [] }) {
  const { classIriById, describe } = index(entries, baseIri, references);
  const statements = [];
  const assert = (subject, predicate, object) => statements.push({ subject, predicate, object });

  for (const entry of entries) {
    if (!definesOwnClass(entry.schema)) continue;
    requireShaclSubset(entry);
    const classIri = classIriById.get(entry.id);
    const shapeIri = `${classIri}Shape`;
    const required = new Set(entry.schema.required ?? []);
    assert(shapeIri, `${RDF}type`, iriTerm(`${SH}NodeShape`));
    assert(shapeIri, `${SH}targetClass`, iriTerm(classIri));

    for (const [propertyName, propertySchema] of Object.entries(entry.schema.properties)) {
      const described = describe(entry, propertySchema);
      if (described.kind === "unsupported") {
        fail(`${entry.id} property ${propertyName} has no faithful SHACL representation`);
      }
      const propertyIri = `${classIri}#${propertyName}`;
      const propertyShapeIri = `${shapeIri}/${propertyName}`;
      assert(shapeIri, `${SH}property`, iriTerm(propertyShapeIri));
      assert(propertyShapeIri, `${SH}path`, iriTerm(propertyIri));
      assert(propertyShapeIri, `${SH}severity`, iriTerm(`${SH}Violation`));
      assert(propertyShapeIri, `${SH}message`, literal(`${propertyName}${required.has(propertyName) ? " is required" : " must satisfy its declared type when present"} per ${entry.id}`));
      if (required.has(propertyName)) assert(propertyShapeIri, `${SH}minCount`, literal(1, { datatype: `${XSD}integer` }));
      if (!described.repeatable) assert(propertyShapeIri, `${SH}maxCount`, literal(1, { datatype: `${XSD}integer` }));
      if (described.kind === "object") {
        assert(propertyShapeIri, `${SH}class`, iriTerm(described.range));
      } else {
        assert(propertyShapeIri, `${SH}datatype`, iriTerm(described.xsd));
        if (Array.isArray(described.enum)) {
          if (described.enum.length === 0) fail(`${entry.id} property ${propertyName} has an empty enum`);
          assert(propertyShapeIri, `${SH}pattern`, literal(`^(${described.enum.map(literalPattern).join("|")})// json-schema-to-ontology — mechanically derives an OWL class model and
// SHACL validation shapes from a set of JSON Schema (draft 2020-12) files,
// so a schema stays the one authored, canonical source and its RDF/OWL/
// SHACL projection is generated, never hand-duplicated. Built on this
// section's own RDF primitives (`rdf-term-construction-service`,
// `rdf-named-graph-construction-service`) rather than hand-formatted
// template strings.
//
// Rule: a schema file mints an owl:Class only when it declares its own
// `properties` object. A schema that only wraps another via `allOf`/`$ref`
// (this house's own per-term thin schemas, e.g. dao.schema.json fixing
// `term: {const: "dao"}` over translation-variance-record.schema.json)
// names an instance of the wrapped class, not a second class — so no
// class, property, or shape is emitted for it. This is a mechanical
// consequence of the rule, not a per-file exception.
import { iriTerm, literal } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-terms";
import { buildNamedGraph } from "@red-cup-engineering/computer-triplet-serialized-content-engineering-services-section/rdf-named-graph";

const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const RDFS = "http://www.w3.org/2000/01/rdf-schema#";
const OWL = "http://www.w3.org/2002/07/owl#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const SH = "http://www.w3.org/ns/shacl#";

const XSD_BY_JSON_SCHEMA_TYPE = Object.freeze({
  string: `${XSD}string`,
  integer: `${XSD}integer`,
  number: `${XSD}decimal`,
  boolean: `${XSD}boolean`,
});

function fail(message) {
  throw new Error(message);
}

/** True for a schema this generator mints a class for: it declares its own `properties`. */
function definesOwnClass(schema) {
  return schema?.type === "object" && schema.properties !== undefined && typeof schema.properties === "object";
}

/** The subschema a JSON Pointer fragment (`/properties/aliases`) names inside `schema`. */
function atPointer(schema, fragment) {
  return fragment.split("/").slice(1).map((token) => decodeURIComponent(token).replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce((node, token) => (node === undefined || node === null ? undefined : node[token]), schema);
}

/**
 * Resolves `$ref`s the way JSON Schema does and describes each property in the one shape this
 * module's two builders need. A `$ref` names its target by retrieval path (relative to the
 * referring file), else by `$id` as the house validator reads one: the bare address first, then
 * resolved against the referring schema's `$id`. A bare reference to a
 * class-defining schema is an object property ranging over that class; a reference with a JSON
 * Pointer fragment reuses that subschema, so it is described as if written in place.
 *
 * `references` are schemas another authority holds (a term schema a note schema borrows from):
 * they resolve `$ref`s but mint nothing here, and a class one defines keeps its own `baseIri`.
 * @param {Array<{id: string, filePath: string, schema: object}>} entries
 * @param {string} baseIri
 * @param {Array<{id: string, filePath: string, schema: object, baseIri?: string}>} [references]
 */
function index(entries, baseIri, references = []) {
  const all = [...entries, ...references];
  const byFilePath = new Map(all.map((entry) => [entry.filePath, entry]));
  const byId = new Map(all.map((entry) => [entry.id, entry]));
  const classIriById = new Map(entries.filter((entry) => definesOwnClass(entry.schema)).map((entry) => [entry.id, `${baseIri}${entry.id}`]));
  const rangeIriById = new Map([
    ...references.filter((entry) => definesOwnClass(entry.schema)).map((entry) => [entry.id, `${entry.baseIri ?? baseIri}${entry.id}`]),
    ...classIriById,
  ]);

  function target(fromEntry, ref) {
    const at = ref.indexOf("#");
    const address = at === -1 ? ref : ref.slice(0, at);
    const fragment = at === -1 ? "" : ref.slice(at + 1);
    if (address === "") return { entry: fromEntry, fragment };
    const entry = byFilePath.get(decodeURIComponent(new URL(address, `file://${fromEntry.filePath}`).pathname))
      ?? byId.get(address)
      ?? byId.get(decodeURIComponent(new URL(address, `https://schema.invalid/${fromEntry.id}`).pathname.slice(1)));
    if (!entry) fail(`$ref ${JSON.stringify(ref)} from ${fromEntry.filePath} does not resolve to a supplied schema entry`);
    return { entry, fragment };
  }

  /** @returns {{kind: "object"|"datatype"|"unsupported", range?: string, xsd?: string, repeatable?: boolean, enum?: unknown[], pattern?: string, description?: string}} */
  function describe(fromEntry, propertySchema) {
    const description = propertySchema.description;
    if (propertySchema.$ref !== undefined) {
      const { entry, fragment } = target(fromEntry, propertySchema.$ref);
      if (fragment === "") {
        const range = rangeIriById.get(entry.id);
        if (!range) fail(`$ref ${JSON.stringify(propertySchema.$ref)} resolves to ${entry.id}, which defines no owl:Class (no own properties)`);
        return { kind: "object", range, repeatable: false, description };
      }
      const reused = atPointer(entry.schema, fragment);
      if (reused === undefined || reused === null || typeof reused !== "object") fail(`$ref ${JSON.stringify(propertySchema.$ref)} from ${fromEntry.filePath} names no subschema of ${entry.id}`);
      const described = describe(entry, reused);
      return { ...described, description: description ?? described.description };
    }
    if (propertySchema.type === "array" && propertySchema.items !== undefined) {
      const item = describe(fromEntry, propertySchema.items);
      if (item.kind === "unsupported" || item.repeatable) return { kind: "unsupported" };
      return { ...item, repeatable: true, description };
    }
    if (XSD_BY_JSON_SCHEMA_TYPE[propertySchema.type] !== undefined) {
      return { kind: "datatype", xsd: XSD_BY_JSON_SCHEMA_TYPE[propertySchema.type], repeatable: false, enum: propertySchema.enum, pattern: propertySchema.pattern, description };
    }
    return { kind: "unsupported" };
  }

  return { classIriById, describe };
}

/**
 * Builds the OWL ontology named graph for a set of JSON Schema entries.
 * @param {Array<{id: string, filePath: string, schema: object}>} entries
 * @param {{baseIri: string, graphName: string}} options
 */
export function buildOwlOntology(entries, { baseIri, graphName, references = [] }) {
  const { classIriById, describe } = index(entries, baseIri, references);
  const statements = [];
  const assert = (subject, predicate, object) => statements.push({ subject, predicate, object });

  for (const entry of entries) {
    if (!definesOwnClass(entry.schema)) continue;
    const classIri = classIriById.get(entry.id);
    assert(classIri, `${RDF}type`, iriTerm(`${OWL}Class`));
    assert(classIri, `${RDFS}label`, literal(entry.schema.title ?? entry.id.split("/").at(-1)));
    if (entry.schema.description) assert(classIri, `${RDFS}comment`, literal(entry.schema.description));

    for (const [propertyName, propertySchema] of Object.entries(entry.schema.properties)) {
      const propertyIri = `${classIri}#${propertyName}`;
      const described = describe(entry, propertySchema);
      if (described.kind === "unsupported") continue;
      assert(propertyIri, `${RDF}type`, iriTerm(`${OWL}${described.kind === "object" ? "Object" : "Datatype"}Property`));
      assert(propertyIri, `${RDFS}domain`, iriTerm(classIri));
      if (described.description) assert(propertyIri, `${RDFS}comment`, literal(described.description));
      if (described.kind === "object") {
        assert(propertyIri, `${RDFS}range`, iriTerm(described.range));
      } else {
        assert(propertyIri, `${RDFS}range`, iriTerm(described.xsd));
      }
    }
  }

  return { namedGraph: buildNamedGraph(statements, graphName), classIriById };
}

/** Keep a JSON Schema enum's lexical values literal under sh:pattern. */
function literalPattern(value) {
  const reserved = new Set(["\\", ".", "+", "*", "?", "^", "$", "{", "}", "(", ")", "[", "]", "|"]);
  return [...String(value)].map(character => reserved.has(character) ? "\\" + character : character).join("");
}

/** Refuse a schema when SHACL would silently omit a load-bearing constraint. */
function requireShaclSubset(entry) {
  const schema = entry.schema;
  for (const key of ["anyOf", "oneOf", "allOf", "not", "if", "then", "else",
    "dependentRequired", "dependentSchemas", "patternProperties",
    "propertyNames", "minProperties", "maxProperties", "unevaluatedProperties"]) {
    if (Object.hasOwn(schema, key)) fail(`${entry.id} uses unsupported JSON Schema constraint ${key}: refusing incomplete SHACL validation`);
  }
  if (Object.hasOwn(schema, "additionalProperties") && schema.additionalProperties !== true) {
    fail(`${entry.id} requires unimplemented additionalProperties handling: refusing incomplete SHACL validation`);
  }
  const properties = schema.properties;
  for (const required of schema.required ?? []) {
    if (!Object.hasOwn(properties, required)) fail(`${entry.id} requires undeclared property ${required}`);
  }
  const supportedPropertyKeys = new Set(["type", "$ref", "description", "title", "default",
    "examples", "$comment", "enum", "pattern", "items"]);
  for (const [name, property] of Object.entries(properties)) {
    for (const key of Object.keys(property)) {
      if (!supportedPropertyKeys.has(key)) {
        fail(`${entry.id} property ${name} uses unsupported ${key}: refusing incomplete SHACL validation`);
      }
    }
  }
}

/**
 * Builds the SHACL shapes named graph for the same schema entries: one
 * sh:NodeShape per class, named (not blank-node) sh:property shapes to
 * stay inside this section's own no-blank-node RDF term rule, and an
 * enum encoded as sh:pattern (a regex alternation) rather than an
 * sh:in RDF list, for the same reason.
 * @param {Array<{id: string, filePath: string, schema: object}>} entries
 * @param {{baseIri: string, graphName: string}} options
 */
export function buildShaclShapes(entries, { baseIri, graphName, references = [] }) {
  const { classIriById, describe } = index(entries, baseIri, references);
  const statements = [];
  const assert = (subject, predicate, object) => statements.push({ subject, predicate, object });

  for (const entry of entries) {
    if (!definesOwnClass(entry.schema)) continue;
    requireShaclSubset(entry);
    const classIri = classIriById.get(entry.id);
    const shapeIri = `${classIri}Shape`;
    const required = new Set(entry.schema.required ?? []);
    assert(shapeIri, `${RDF}type`, iriTerm(`${SH}NodeShape`));
    assert(shapeIri, `${SH}targetClass`, iriTerm(classIri));

    for (const [propertyName, propertySchema] of Object.entries(entry.schema.properties)) {
      const described = describe(entry, propertySchema);
      if (described.kind === "unsupported") {
        fail(`${entry.id} property ${propertyName} has no faithful SHACL representation`);
      }
      const propertyIri = `${classIri}#${propertyName}`;
      const propertyShapeIri = `${shapeIri}/${propertyName}`;
      assert(shapeIri, `${SH}property`, iriTerm(propertyShapeIri));
      assert(propertyShapeIri, `${SH}path`, iriTerm(propertyIri));
      assert(propertyShapeIri, `${SH}severity`, iriTerm(`${SH}Violation`));
      assert(propertyShapeIri, `${SH}message`, literal(`${propertyName}${required.has(propertyName) ? " is required" : " must satisfy its declared type when present"} per ${entry.id}`));
      if (required.has(propertyName)) assert(propertyShapeIri, `${SH}minCount`, literal(1, { datatype: `${XSD}integer` }));
      if (!described.repeatable) assert(propertyShapeIri, `${SH}maxCount`, literal(1, { datatype: `${XSD}integer` }));
      if (described.kind === "object") {
        assert(propertyShapeIri, `${SH}class`, iriTerm(described.range));
      } else {
        assert(propertyShapeIri, `${SH}datatype`, iriTerm(described.xsd));
        if (Array.isArray(described.enum)) {
));
        } else if (typeof described.pattern === "string") {
          assert(propertyShapeIri, `${SH}pattern`, literal(described.pattern));
        }
      }
    }
  }

  return { namedGraph: buildNamedGraph(statements, graphName), classIriById };
}
