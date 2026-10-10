#!/usr/bin/env node
// usage: project-json-schema-as-ontology <schemaDirectory> <baseIri> [--out-dir <dir>] [--reference <file>]...
//
// Reads every *.schema.json file directly under <schemaDirectory>, derives
// its owl:Class model and SHACL shapes (json-schema-to-ontology.mjs), and
// writes ontology.ttl and shapes.ttl to --out-dir (default: schemaDirectory).
// A schema's own `$id` is used as its logical identity under <baseIri>; a
// schema stating no `$id` is refused rather than guessed at. Each --reference
// is a schema another authority holds that the set's `$ref`s may name; it
// resolves them and mints nothing.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { buildOwlOntology, buildShaclShapes } from "../src/json-schema-to-ontology.mjs";
import { renderNamedGraphAsTurtle } from "../src/named-graph-as-prefixed-turtle.mjs";

const PREFIXES = Object.freeze({
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  rdfs: "http://www.w3.org/2000/01/rdf-schema#",
  owl: "http://www.w3.org/2002/07/owl#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
  sh: "http://www.w3.org/ns/shacl#",
});

function readSchemaEntry(filePath) {
  const schema = JSON.parse(readFileSync(filePath, "utf8"));
  if (typeof schema.$id !== "string" || schema.$id.trim() === "") throw new Error(`${filePath} has no $id; refusing to guess its logical identity`);
  return { id: schema.$id, filePath, schema };
}

function readSchemaEntries(schemaDirectory) {
  return readdirSync(schemaDirectory)
    .filter((filename) => filename.endsWith(".schema.json"))
    .sort()
    .map((filename) => readSchemaEntry(resolve(join(schemaDirectory, filename))));
}

export function projectJsonSchemaSetAsOntology({ schemaDirectory, baseIri, outDir = schemaDirectory, references = [] }) {
  const entries = readSchemaEntries(schemaDirectory);
  const referenced = references.map((filePath) => readSchemaEntry(resolve(filePath)));
  const ontology = buildOwlOntology(entries, { baseIri, graphName: `${baseIri}ontology`, references: referenced });
  const shapes = buildShaclShapes(entries, { baseIri, graphName: `${baseIri}shapes`, references: referenced });

  const header = [
    "GENERATED — do not edit by hand.",
    "Regenerate with json-schema-to-owl-shacl-service's project-json-schema-as-ontology",
    `over ${relative(outDir, schemaDirectory) || "."} (relative to this file), after editing a *.schema.json file there.`,
    ...(referenced.length === 0 ? [] : [`References: ${referenced.map((entry) => entry.id).join(", ")}.`]),
    `Classes minted: ${[...ontology.classIriById.keys()].join(", ")}.`,
  ];

  const ontologyPath = join(outDir, "ontology.ttl");
  const shapesPath = join(outDir, "shapes.ttl");
  writeFileSync(ontologyPath, renderNamedGraphAsTurtle(ontology.namedGraph, PREFIXES, header));
  writeFileSync(shapesPath, renderNamedGraphAsTurtle(shapes.namedGraph, PREFIXES, header));
  return { ontologyPath, shapesPath, classes: [...ontology.classIriById.keys()], ontologyTriples: ontology.namedGraph.size, shapesTriples: shapes.namedGraph.size };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [schemaDirectory, baseIri] = process.argv.slice(2).filter((arg, at, args) => !arg.startsWith("--") && !["--out-dir", "--reference"].includes(args[at - 1]));
  const outDirFlagIndex = process.argv.indexOf("--out-dir");
  const outDir = outDirFlagIndex === -1 ? undefined : process.argv[outDirFlagIndex + 1];
  if (!schemaDirectory || !baseIri) {
    process.stderr.write("usage: project-json-schema-as-ontology <schemaDirectory> <baseIri> [--out-dir <dir>] [--reference <file>]...\n");
    process.exit(2);
  }
  const references = process.argv.flatMap((arg, at) => (arg === "--reference" ? [process.argv[at + 1]] : []));
  const result = projectJsonSchemaSetAsOntology({ schemaDirectory: resolve(schemaDirectory), baseIri, outDir: outDir ? resolve(outDir) : undefined, references });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
