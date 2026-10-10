// named-graph-as-prefixed-turtle — renders a named-graph quad-set (as built
// by rdf-named-graph-construction-service) as human-readable Turtle text,
// compacting any IRI under a supplied prefix map and falling back to a
// full IRIREF otherwise. Built on the Turtle codec's `iriRef`/
// `turtleLiteral` writers rather than hand-rolled escaping.
import { iriRef, turtleLiteral } from "@red-cup-engineering/turtle-services-section/turtle";

const XSD_INTEGER = "http://www.w3.org/2001/XMLSchema#integer";
const XSD_DECIMAL = "http://www.w3.org/2001/XMLSchema#decimal";
const XSD_BOOLEAN = "http://www.w3.org/2001/XMLSchema#boolean";

function compactOrRef(iri, prefixes) {
  for (const [prefix, namespace] of Object.entries(prefixes)) {
    if (iri.startsWith(namespace) && !iri.slice(namespace.length).includes("/")) return `${prefix}:${iri.slice(namespace.length)}`;
  }
  return iriRef(iri);
}

function writeObject(term, prefixes) {
  if (term.kind === "iri") return compactOrRef(term.value, prefixes);
  if (term.datatype === XSD_INTEGER || term.datatype === XSD_DECIMAL) return turtleLiteral(Number(term.value));
  if (term.datatype === XSD_BOOLEAN) return turtleLiteral(term.value === "true");
  const quoted = turtleLiteral(term.value);
  if (term.datatype !== undefined) return `${quoted}^^${compactOrRef(term.datatype, prefixes)}`;
  if (term.language !== undefined) return `${quoted}@${term.language}`;
  return quoted;
}

/**
 * Renders a named-graph quad-set as Turtle text: a `@prefix` line per
 * supplied prefix, then one `subject predicate object .` statement per
 * quad, grouped and blank-line-separated by subject for legibility. The
 * graph name itself is not rendered (Turtle has no native named-graph
 * syntax; the graph identity is this file's own path).
 * @param {{quads: ReadonlyArray<{subject: string, predicate: string, object: object}>}} namedGraph
 * @param {Record<string, string>} prefixes prefix -> namespace IRI
 * @param {string[]} [headerLines] comment lines written before the prefixes
 */
export function renderNamedGraphAsTurtle(namedGraph, prefixes, headerLines = []) {
  const lines = [];
  for (const line of headerLines) lines.push(`# ${line}`);
  if (headerLines.length > 0) lines.push("");
  for (const [prefix, namespace] of Object.entries(prefixes)) lines.push(`@prefix ${prefix}: ${iriRef(namespace)} .`);

  const bySubject = new Map();
  for (const quad of namedGraph.quads) {
    if (!bySubject.has(quad.subject)) bySubject.set(quad.subject, []);
    bySubject.get(quad.subject).push(quad);
  }

  for (const [subject, quads] of bySubject) {
    lines.push("");
    const predicateObjectLines = quads.map((quad) => `    ${compactOrRef(quad.predicate, prefixes)} ${writeObject(quad.object, prefixes)}`);
    lines.push(`${compactOrRef(subject, prefixes)}\n${predicateObjectLines.join(" ;\n")} .`);
  }

  return `${lines.join("\n")}\n`;
}
