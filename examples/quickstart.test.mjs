import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { buildOwlOntology } from "@red-cup-engineering/json-schema-to-owl-shacl-service";

test("SCHEMA-ONTOLOGY-QUICKSTART", () => {
  const result = buildOwlOntology([{
    id: "widget", filePath: "/schemas/widget.schema.json",
    schema: { $id: "widget", title: "Widget", type: "object", properties: { name: { type: "string" } } },
  }], { baseIri: "https://example.org/schema/", graphName: "https://example.org/graph" });
  assert.equal(result.classIriById.has("widget"), true);
});


test("SCHEMA-ONTOLOGY-INSTALLED-COMMAND", async t => {
  const root = await mkdtemp(join(tmpdir(), "schema-ontology-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const schemaDirectory = join(root, "schemas");
  const output = join(root, "derived");
  await mkdir(schemaDirectory);
  await mkdir(output);
  await writeFile(join(schemaDirectory, "widget.schema.json"), JSON.stringify({
    $id: "widget", title: "Widget", type: "object",
    properties: { name: { type: "string" } }, required: ["name"],
  }));
  const installed = import.meta.resolve("@red-cup-engineering/json-schema-to-owl-shacl-service/project");
  const command = join(root, "project-json-schema-as-ontology");
  await symlink(fileURLToPath(installed), command);
  const result = JSON.parse(execFileSync(process.execPath,
    [command, schemaDirectory, "https://example.org/schema/", "--out-dir", output],
    { encoding: "utf8", timeout: 5000 }));
  assert.deepEqual(result.classes, ["widget"]);
  assert.match(await readFile(join(output, "ontology.ttl"), "utf8"), /owl:Class/u);
  assert.match(await readFile(join(output, "shapes.ttl"), "utf8"), /sh:minCount/u);
});
