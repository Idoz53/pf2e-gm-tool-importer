import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const toolDirectory = path.dirname(fileURLToPath(import.meta.url));
const moduleRoot = path.resolve(toolDirectory, "..");
const libraryRoot = path.resolve(moduleRoot, "..", "pf2e-gm-desktop", "src", "data", "pf2e-class-rules");
const outputFile = path.join(moduleRoot, "data", "pf2e-class-rules-index.json");

function slug(value = "") {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

const manifest = JSON.parse(await readFile(path.join(libraryRoot, "manifest.json"), "utf8"));
const classDirectory = path.join(libraryRoot, "classes");
const classFiles = (await readdir(classDirectory)).filter((filename) => filename.endsWith(".json")).sort();
const recordMap = new Map();
const classes = [];

function addRecord(record, className = "") {
  const existing = recordMap.get(record.id);
  if (existing) {
    existing.classes = unique([...existing.classes, className]);
    existing.traits = unique([...existing.traits, ...(record.traits ?? [])]);
    return;
  }
  recordMap.set(record.id, {
    id: record.id,
    name: record.name,
    slug: slug(record.name),
    kind: record.kind,
    level: record.level,
    classes: className ? [className] : [],
    traits: record.traits ?? [],
    aonUrl: record.source?.url ?? "",
    aonSource: record.source?.primary ?? "",
  });
}

for (const filename of classFiles) {
  const payload = JSON.parse(await readFile(path.join(classDirectory, filename), "utf8"));
  classes.push({
    id: payload.class.id,
    name: payload.class.name,
    slug: slug(payload.class.name),
    filename,
    sourceUrl: payload.class.source?.url ?? "",
  });
  payload.sections.class_features.forEach((record) => addRecord(record, payload.class.name));
  payload.sections.class_feats.forEach((record) => addRecord(record, payload.class.name));
}

const shared = JSON.parse(await readFile(path.join(libraryRoot, "skill-and-general-feats.json"), "utf8"));
shared.sections.skill_feats.forEach((record) => addRecord(record));
shared.sections.general_feats.forEach((record) => addRecord(record));

const records = [...recordMap.values()].sort((left, right) =>
  left.slug.localeCompare(right.slug)
  || Number(left.level ?? 0) - Number(right.level ?? 0)
  || left.kind.localeCompare(right.kind));

const index = {
  schema: "pf2e-gm-tool/rules-index@1",
  generatedAt: manifest.generated_at,
  builtAt: new Date().toISOString(),
  source: manifest.source,
  classes,
  records,
  counts: {
    classes: classes.length,
    records: records.length,
    classFeatures: records.filter((record) => record.kind.startsWith("class_feature")).length,
    classFeats: records.filter((record) => record.kind === "class_feat").length,
    skillFeats: records.filter((record) => record.kind === "skill_feat").length,
    generalFeats: records.filter((record) => record.kind === "general_feat").length,
  },
};

await mkdir(path.dirname(outputFile), { recursive: true });
await writeFile(outputFile, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Wrote ${records.length} canonical rule references to ${outputFile}`);
