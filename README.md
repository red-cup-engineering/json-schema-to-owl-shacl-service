# @red-cup-engineering/json-schema-to-owl-shacl-service

Mechanically derives an OWL class model and SHACL validation shapes from a
set of JSON Schema (draft 2020-12) files, so a schema stays the one
authored, canonical source and its RDF projection is generated — never a
second hand-maintained artifact stating the same facts under a parallel
vocabulary.

Built on this section's own RDF primitives
(`rdf-term-construction-service`'s `iriTerm`/`literal`,
`rdf-named-graph-construction-service`'s `buildNamedGraph`,
`turtle-services-section/services/turtle-term-writing-service`'s
`iriRef`/`turtleLiteral`), not hand-formatted template strings.

## Rule

A schema file mints an `owl:Class` only when it declares its own
`properties` object. A schema that only wraps another via `allOf`/`$ref`
(a thin per-instance schema fixing one field with `const`) names an
*instance* of the wrapped class, not a second class — so no class,
property, or shape is emitted for it. Mechanical consequence of the rule,
not a per-file exception.

- A `$ref` resolves as JSON Schema reads one: by retrieval path relative
  to the referring file, else by `$id` (the bare address first, then
  resolved against the referring schema's `$id`, as the house validator
  does).
- A property that is a `$ref` to a whole schema (or an `array` of one)
  becomes an `owl:ObjectProperty`, `rdfs:range` the referenced schema's
  class IRI — which must itself define its own `properties`, or the `$ref`
  is refused rather than silently dropped.
- A `$ref` with a JSON Pointer fragment
  (`glossary/terms/term#/properties/aliases`) reuses that subschema, so the
  property is described as if the subschema were written in place. A
  pointer that names nothing is refused.
- A property whose `type` is `string`/`integer`/`number`/`boolean` (or an
  `array` of one of those) becomes an `owl:DatatypeProperty`, `rdfs:range`
  the mapped `xsd:` type.
- SHACL: one named `sh:NodeShape` per class (`<classIri>Shape`), with one
  named `sh:property` shape per property (`<classIri>Shape/<property>`) —
  named, not blank-node, shapes throughout, because this section's own RDF
  term primitives refuse blank nodes by design. A `required` property gets
  `sh:minCount 1` and `sh:severity sh:Violation`; an optional one gets
  `sh:severity sh:Warning` and no `sh:minCount`. A non-array property gets
  `sh:maxCount 1`. A JSON Schema `enum` becomes `sh:pattern` (a regex
  alternation) rather than an `sh:in` RDF list, for the same
  no-blank-nodes reason (`sh:in`'s list structure is conventionally blank
  nodes). A string `pattern` becomes `sh:pattern` as written.

## Use

```
node scripts/project-json-schema-set-as-ontology.mjs <schemaDirectory> <baseIri> [--out-dir <dir>] [--reference <file>]...
```

Reads every `*.schema.json` directly under `<schemaDirectory>` (each must
state its own `$id`), writes `ontology.ttl` and `shapes.ttl` to `--out-dir`
(default: `<schemaDirectory>`). Each `--reference` is a schema another
authority holds that the set's `$ref`s may name: it resolves them and mints
nothing, and a class it defines keeps the reference's own IRI. The header
names the schema directory relative to the output, so the generated files
read the same on every machine. Rerun after editing a schema; the two
`.ttl` files are generated output, never a hand-edited second source.

## Tests

`npm test` runs the package's own `node --test` suite against a small
synthetic schema fixture (a `widget`/`owner` pair plus a thin
`released-widget` wrapper, and a `note` borrowing from a referenced `term`), independent of any consuming section's real
schemas.
