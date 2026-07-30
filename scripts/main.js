const MODULE_ID = "pf2e-gm-tool-importer";
const EXPORT_SCHEMAS = new Set([
  "pf2e-gm-tool/creature@1",
  "pf2e-gm-tool/creature@2",
  "pf2e-gm-tool/creature@3",
]);

const ACTION_ICONS = {
  passive: "systems/pf2e/icons/actions/Passive.webp",
  "1": "systems/pf2e/icons/actions/OneAction.webp",
  "2": "systems/pf2e/icons/actions/TwoActions.webp",
  "3": "systems/pf2e/icons/actions/ThreeActions.webp",
  reaction: "systems/pf2e/icons/actions/Reaction.webp",
  free: "systems/pf2e/icons/actions/FreeAction.webp",
};

const CONDITION_NAMES = [
  "Blinded", "Broken", "Clumsy", "Concealed", "Confused", "Controlled",
  "Dazzled", "Deafened", "Doomed", "Drained", "Dying", "Encumbered",
  "Enfeebled", "Fascinated", "Fatigued", "Fleeing", "Frightened", "Grabbed",
  "Hidden", "Immobilized", "Invisible", "Observed", "Off-Guard", "Paralyzed",
  "Persistent Damage", "Petrified", "Prone", "Quickened", "Restrained",
  "Sickened", "Slowed", "Stunned", "Stupefied", "Unconscious", "Undetected",
  "Unfriendly", "Wounded",
];

const ACTION_NAMES = [
  "Demoralize", "Escape", "Fly", "Grab", "Grapple", "Maneuver in Flight",
  "Shove", "Step", "Stride", "Strike", "Trip",
];

const DAMAGE_TYPES = [
  "acid", "bleed", "bludgeoning", "cold", "electricity", "fire", "force",
  "mental", "piercing", "poison", "precision", "slashing", "sonic",
  "spirit", "vitality", "void",
];

const conditionUuidByName = new Map();

function htmlEscape(value = "") {
  const node = document.createElement("span");
  node.textContent = String(value);
  return node.innerHTML;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sizeValue(size) {
  const sizes = {
    tiny: "tiny", sm: "sm", small: "sm", med: "med", medium: "med",
    lg: "lg", large: "lg", huge: "huge", grg: "grg", gargantuan: "grg",
  };
  return sizes[String(size).toLowerCase()] ?? "med";
}

function slug(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

const RULES_LIBRARY_ID = "pf2e-class-rules@1";
let rulesIndexPromise = null;

function foundrySourceId(item) {
  return item?.sourceId
    ?? item?.flags?.core?.sourceId
    ?? item?._stats?.compendiumSource
    ?? "";
}

function rulesIndexUrl() {
  const localPath = `modules/${MODULE_ID}/data/pf2e-class-rules-index.json`;
  return foundry?.utils?.getRoute?.(localPath) ?? `/${localPath}`;
}

async function loadRulesIndex() {
  rulesIndexPromise ??= fetch(rulesIndexUrl()).then(async (response) => {
    if (!response.ok) throw new Error(`Rules library index returned ${response.status}.`);
    const data = await response.json();
    if (data.schema !== "pf2e-gm-tool/rules-index@1") {
      throw new Error(`Unsupported rules library index: ${data.schema ?? "unknown"}.`);
    }
    const recordsBySlug = new Map();
    for (const record of data.records ?? []) {
      if (!recordsBySlug.has(record.slug)) recordsBySlug.set(record.slug, []);
      recordsBySlug.get(record.slug).push(record);
    }
    const classesBySlug = new Map((data.classes ?? []).map((entry) => [entry.slug, entry]));
    return { ...data, recordsBySlug, classesBySlug };
  });
  return rulesIndexPromise;
}

function expectedRuleKinds(item) {
  const category = String(item.system?.category ?? item.system?.featType?.value ?? "").toLowerCase();
  if (item.type === "action") return ["class_feature_action"];
  if (category === "classfeature") {
    return ["class_feature", "class_feature_action", "class_feature_option"];
  }
  if (category === "class") return ["class_feat"];
  if (category === "skill") return ["skill_feat"];
  if (category === "general") return ["general_feat"];
  return [];
}

function matchRuleRecord(item, className, rulesIndex) {
  const itemSlug = slug(item.slug ?? item.system?.slug ?? item.name);
  const candidates = rulesIndex?.recordsBySlug?.get(itemSlug) ?? [];
  if (!candidates.length) return null;
  const itemLevel = number(item.system?.level?.value ?? item.level, 0);
  const expected = expectedRuleKinds(item);
  const scored = candidates.map((record) => {
    let score = 0;
    if (record.name === item.name) score += 2;
    if (Number(record.level ?? 0) === itemLevel) score += 5;
    if (expected.includes(record.kind)) score += 9;
    if ((record.classes ?? []).includes(className)) score += 12;
    if (item.type === "action" && record.kind === "class_feature_action") score += 8;
    return { record, score };
  }).sort((left, right) =>
    right.score - left.score
    || String(left.record.id).localeCompare(String(right.record.id)));
  if (!scored[0] || scored[0].score < 5) return null;
  if (scored[1]?.score === scored[0].score && scored[1].record.id !== scored[0].record.id) {
    return null;
  }
  return scored[0].record;
}

function libraryReference(record, matchBasis = "slug+level+category+class") {
  return record ? {
    library: RULES_LIBRARY_ID,
    id: record.id,
    kind: record.kind,
    sourceUrl: record.aonUrl ?? "",
    matchBasis,
  } : null;
}

function itemSelections(item) {
  const ruleSelections = item.flags?.pf2e?.rulesSelections ?? {};
  const ruleValues = (item.system?.rules ?? []).map((rule) => ({
    key: rule.key ?? "",
    label: rule.label ?? "",
    selection: rule.selection ?? rule.value ?? rule.option ?? null,
  })).filter((rule) => rule.selection !== null || rule.label);
  return { ruleSelections: structuredClone(ruleSelections), ruleValues };
}

function deduplicateOwnedRules(records) {
  const deduplicated = new Map();
  for (const record of records) {
    const selectionSignature = JSON.stringify(record.selections ?? {});
    const canonicalIdentity = record.libraryRef?.id
      ? `${record.libraryRef.library}:${record.libraryRef.id}`
      : record.sourceId || `${record.category}:${record.slug}:${record.level}`;
    const key = `${canonicalIdentity}|${selectionSignature}`;
    const existing = deduplicated.get(key);
    if (!existing) {
      deduplicated.set(key, { ...record, mergedItemIds: [] });
      continue;
    }
    existing.mergedItemIds = [...new Set([
      ...(existing.mergedItemIds ?? []),
      existing.itemId,
      record.itemId,
      ...(record.mergedItemIds ?? []),
    ].filter(Boolean))];
    existing.rules = existing.rules?.length ? existing.rules : record.rules;
    existing.description = existing.description || record.description;
  }
  return [...deduplicated.values()];
}

function splitList(value) {
  if (Array.isArray(value)) return value.flatMap(splitList);
  return String(value ?? "")
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceConditionLinks(text) {
  const pattern = new RegExp(`\\b(${CONDITION_NAMES.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|")})(?:\\s+\\d+)?\\b`, "gi");
  return text.replace(pattern, (match, name) => {
    const uuid = conditionUuidByName.get(name.toLowerCase());
    return uuid ? `@UUID[${uuid}]{${match}}` : match;
  });
}

function replaceActionLinks(text) {
  const pattern = new RegExp(`\\b(${ACTION_NAMES.map(escapeRegExp).sort((a, b) => b.length - a.length).join("|")})\\b`, "gi");
  return text.replace(pattern, (match) => `[[/act ${slug(match)}]]{${match}}`);
}

async function loadInlineLinkIndexes() {
  if (conditionUuidByName.size) return;
  const pack = game.packs.get("pf2e.conditionitems");
  if (!pack) return;
  const index = await pack.getIndex({ fields: ["name"] });
  for (const entry of index) {
    conditionUuidByName.set(entry.name.toLowerCase(), `Compendium.pf2e.conditionitems.Item.${entry._id}`);
  }
}

function automateRulesText(value = "") {
  let text = htmlEscape(value);
  text = text.replace(
    /\bDC\s*(\d+)\s+(basic\s+)?(Fortitude|Reflex|Will)\s+save\b/gi,
    (_match, dc, basic, save) => `@Check[${save.toLowerCase()}|dc:${dc}${basic ? "|basic" : ""}]{DC ${dc} ${basic ?? ""}${save} save}`,
  );
  text = text.replace(
    /\bDC\s*(\d+)\s+flat\s+check\b/gi,
    (_match, dc) => `@Check[flat|dc:${dc}]{DC ${dc} flat check}`,
  );
  const damagePattern = new RegExp(`\\b(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+(${DAMAGE_TYPES.join("|")})\\s+damage\\b`, "gi");
  text = text.replace(damagePattern, (_match, formula, type) => {
    const cleanFormula = formula.replace(/\s+/g, "");
    const cleanType = type.toLowerCase();
    return `@Damage[${cleanFormula}[${cleanType}]]{${formula} ${type} damage}`;
  });
  text = replaceConditionLinks(text);
  text = replaceActionLinks(text);
  return text.replace(/\r?\n/g, "<br>");
}

function parseArea(...values) {
  const text = values.filter(Boolean).join(" ");
  const match = text.match(/\b(\d+)[-\s]?foot[-\s]+(?:long[-\s]+)?(burst|cone|line|emanation)\b/i);
  if (!match) return null;
  const width = match[2].toLowerCase() === "line"
    ? number(text.match(/\b(\d+)[-\s]?foot[-\s]+wide\b/i)?.[1], 5)
    : null;
  return { type: match[2].toLowerCase(), value: number(match[1]), width };
}

function parseRangeFeet(...values) {
  const text = values.filter(Boolean).join(" ");
  const explicit = text.match(/\b(?:range|within)\s+(\d+)\s+feet\b/i);
  if (explicit) return number(explicit[1]);
  const plain = text.trim().match(/^(\d+)\s+feet\b/i);
  return plain ? number(plain[1]) : null;
}

function templateLink(area, rangeFeet) {
  if (area) {
    const width = area.type === "line" && area.width ? `|width:${area.width}` : "";
    return `@Template[type:${area.type}|distance:${area.value}${width}]{${area.value}-foot ${area.type}}`;
  }
  if (rangeFeet) {
    return `@Template[type:emanation|distance:${rangeFeet}]{Show ${rangeFeet}-foot range}`;
  }
  return "";
}

function sourceLink(url) {
  return url
    ? `<p><a href="${htmlEscape(url)}" target="_blank" rel="noopener noreferrer">Archives of Nethys</a></p>`
    : "";
}

function componentAutomation(components = []) {
  const rows = [];
  for (const component of components) {
    const label = String(component.label || component.type || "Effect");
    const value = String(component.value ?? "").trim();
    if (!value) continue;
    if (component.type === "dc") {
      const save = label.match(/\b(Fortitude|Reflex|Will)\b/i)?.[1]?.toLowerCase();
      rows.push(save
        ? `<p><strong>${htmlEscape(label)}</strong> @Check[${save}|dc:${number(value)}]{DC ${number(value)} ${save} save}</p>`
        : `<p><strong>${htmlEscape(label)}</strong> DC ${htmlEscape(value)}</p>`);
      continue;
    }
    if (component.type === "single" || component.type === "area") {
      const damageType = DAMAGE_TYPES.find((type) => new RegExp(`\\b${type}\\b`, "i").test(label)) ?? "untyped";
      rows.push(`<p><strong>${htmlEscape(label)}</strong> @Damage[${htmlEscape(value)}[${damageType}]]{${htmlEscape(value)} damage}</p>`);
      continue;
    }
    rows.push(`<p><strong>${htmlEscape(label)}</strong> ${htmlEscape(value)}</p>`);
  }
  return rows.join("");
}

function richDescription(text, { range = "", target = "", components = [], sourceUrl = "" } = {}) {
  const area = parseArea(range, target, text);
  const rangeFeet = area ? null : parseRangeFeet(range, target);
  const template = templateLink(area, rangeFeet);
  return [
    `<p>${automateRulesText(text || "Imported from PF2e GM Tool.")}</p>`,
    componentAutomation(components),
    template ? `<p><strong>Area / Range</strong> ${template}</p>` : "",
    sourceLink(sourceUrl),
  ].join("");
}

function normalizeActionCost(value, description = "") {
  const direct = String(value ?? "").toLowerCase().trim();
  const aliases = {
    "single action": "1", one: "1", "one action": "1",
    "two actions": "2", two: "2",
    "three actions": "3", three: "3",
    reaction: "reaction", "free action": "free", free: "free",
    passive: "passive",
  };
  if (["1", "2", "3"].includes(direct)) return direct;
  if (aliases[direct]) return aliases[direct];
  const marker = String(description).match(/\[(Single Action|Two Actions|Three Actions|Reaction|Free Action)\]/i)?.[1];
  return marker ? aliases[marker.toLowerCase()] : "passive";
}

function actionTypeFor(cost) {
  if (cost === "reaction") return "reaction";
  if (cost === "free") return "free";
  if (cost === "passive") return "passive";
  return "action";
}

function traitValues(value, excluded = []) {
  const excludedSet = new Set(excluded.map(slug));
  return splitList(value)
    .map(slug)
    .filter((entry) => entry && !excludedSet.has(entry));
}

function actionSource(ability) {
  const cost = normalizeActionCost(ability.actionCost, ability.description);
  return {
    name: ability.name || "Ability",
    type: "action",
    img: ACTION_ICONS[cost],
    system: {
      actionType: { value: actionTypeFor(cost) },
      actions: { value: ["1", "2", "3"].includes(cost) ? number(cost) : null },
      category: "offensive",
      description: {
        value: richDescription(ability.description, {
          range: ability.range,
          components: ability.components,
          sourceUrl: ability.sourceUrl,
        }),
      },
      publication: { license: "ORC", remaster: true, title: "PF2e GM Tool" },
      rules: [],
      slug: null,
      traits: { rarity: "common", value: traitValues(ability.traits) },
    },
  };
}

function strikeTrait(value) {
  const normalized = String(value).trim().toLowerCase();
  const reach = normalized.match(/^reach\s+(\d+)(?:\s+feet)?$/);
  if (reach) return `reach-${reach[1]}`;
  const thrown = normalized.match(/^thrown\s+(\d+)(?:\s+feet)?$/);
  if (thrown) return `thrown-${thrown[1]}`;
  return slug(normalized);
}

function strikeSource(strike) {
  const category = String(strike.category || "melee").toLowerCase();
  const rawTraits = splitList(strike.traits);
  const attackEffectNames = new Set(["grab", "improved grab", "knockdown", "improved knockdown", "push"]);
  const attackEffects = rawTraits
    .filter((entry) => attackEffectNames.has(entry.toLowerCase()))
    .map(slug);
  const traits = rawTraits
    .filter((entry) => !attackEffectNames.has(entry.toLowerCase()))
    .map(strikeTrait);
  if (category === "ranged" && !traits.some((trait) => trait.startsWith("range-") || trait.startsWith("thrown-"))) {
    const range = parseRangeFeet(strike.range);
    if (range) traits.push(`range-${range}`);
  }
  const damage = String(strike.damage || "1").replace(new RegExp(`\\s+(${DAMAGE_TYPES.join("|")})(?:\\s+damage)?$`, "i"), "").trim();
  const damageType = slug(strike.damageType || "bludgeoning");
  const bonus = number(strike.attack);
  const rollFormula = bonus >= 0 ? `1d20+${bonus}` : `1d20${bonus}`;
  return {
    name: strike.name || "Strike",
    type: "melee",
    img: "systems/pf2e/icons/default-icons/melee.svg",
    system: {
      attackEffects: { value: attackEffects },
      bonus: { value: bonus },
      damageRolls: {
        primary: { damage, damageType },
      },
      description: {
        value: `<p>[[/r ${rollFormula}]]{Attack ${bonus >= 0 ? "+" : ""}${bonus}}; @Damage[${damage}[${damageType}]]{${htmlEscape(damage)} ${htmlEscape(damageType)} damage}</p>`,
      },
      range: category === "ranged" ? parseRangeFeet(strike.range) : null,
      rules: [],
      slug: null,
      traits: { value: traits, otherTags: [] },
      publication: { license: "ORC", remaster: true, title: "PF2e GM Tool" },
    },
  };
}

function normalizedSpellName(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function comparableSpellName(value) {
  return normalizedSpellName(value).replace(/[^a-z0-9]/g, "");
}

function entryMatchesSpellName(entry, expectedName, comparableName) {
  const names = [entry.name, entry.originalName].filter(Boolean);
  return names.some((name) =>
    normalizedSpellName(name) === expectedName || comparableSpellName(name) === comparableName);
}

async function compendiumBrowserSpellIndex() {
  const tab = game.pf2e?.compendiumBrowser?.tabs?.spell;
  if (!tab) return [];
  await tab.init();
  return Array.from(tab.indexData ?? []);
}

async function findSpellInPacks(expectedName, comparableName) {
  for (const pack of game.packs) {
    if (pack.documentName !== "Item") continue;
    let index;
    try {
      index = await pack.getIndex({ fields: ["name", "type", "originalName"] });
    } catch (_error) {
      continue;
    }
    const match = index.find((entry) =>
      entry.type === "spell" && entryMatchesSpellName(entry, expectedName, comparableName));
    if (!match) continue;
    const document = await pack.getDocument(match._id);
    if (document) return document;
  }
  return null;
}

async function findOfficialSpell(request, browserIndex) {
  const expectedName = normalizedSpellName(request.name);
  const comparableName = comparableSpellName(request.name);
  const browserMatch = browserIndex.find((entry) =>
    entryMatchesSpellName(entry, expectedName, comparableName));
  if (browserMatch?.uuid) {
    const document = await fromUuid(browserMatch.uuid);
    if (document?.type === "spell") return document;
  }
  return findSpellInPacks(expectedName, comparableName);
}

async function officialSpellSources(requests, entryId) {
  const resolved = [];
  const missing = [];
  const browserIndex = await compendiumBrowserSpellIndex();
  for (const request of requests) {
    const document = await findOfficialSpell(request, browserIndex);
    if (!document) {
      missing.push(request.name || "Unnamed spell");
      continue;
    }
    const source = document.toObject();
    const id = foundry.utils.randomID();
    const spellTraits = source.system.traits.value instanceof Set
      ? Array.from(source.system.traits.value)
      : source.system.traits.value;
    const isCantrip = spellTraits.includes("cantrip");
    source._id = id;
    source.system.location = {
      ...source.system.location,
      value: entryId,
    };
    source.flags ??= {};
    source.flags.core ??= {};
    source.flags.core.sourceId = document.uuid;
    delete source.folder;
    delete source.sort;
    delete source.ownership;
    delete source._stats;
    resolved.push({
      id,
      isCantrip,
      rank: Math.max(1, number(source.system.level.value)),
      source,
    });
  }
  return { resolved, missing };
}

function spellcastingEntrySource(casting, entryId, preparedSpells) {
  const modeAliases = { prepared: "prepared", spontaneous: "spontaneous", innate: "innate" };
  const mode = modeAliases[String(casting.mode || "").toLowerCase()] ?? "prepared";
  const cantrips = preparedSpells.filter((spell) => spell.isCantrip);
  const slots = {
    slot0: {
      max: cantrips.length,
      value: 0,
      ...(mode === "prepared" ? { prepared: cantrips.map((spell) => ({ id: spell.id, expended: false })) } : {}),
    },
  };
  for (let rank = 1; rank <= 10; rank += 1) {
    const spells = preparedSpells.filter((spell) => !spell.isCantrip && number(spell.rank) === rank);
    slots[`slot${rank}`] = {
      max: spells.length,
      value: spells.length,
      ...(mode === "prepared" ? { prepared: spells.map((spell) => ({ id: spell.id, expended: false })) } : {}),
    };
  }
  return {
    _id: entryId,
    name: `${casting.tradition || "Arcane"} ${casting.mode || "Prepared"} Spells`,
    type: "spellcastingEntry",
    img: "systems/pf2e/icons/default-icons/spellcastingEntry.svg",
    system: {
      autoHeightenLevel: { value: null },
      description: { value: "" },
      prepared: { value: mode },
      proficiency: { value: 1 },
      publication: { license: "ORC", remaster: true, title: "PF2e GM Tool" },
      rules: [],
      slots,
      slug: null,
      spelldc: { dc: number(casting.dc), value: number(casting.attack) },
      tradition: { value: slug(casting.tradition || "arcane") === "nature" ? "primal" : slug(casting.tradition || "arcane") },
      traits: {},
    },
  };
}

async function importedItems(creature) {
  const sources = [
    ...(creature.strikes ?? []).map(strikeSource),
    ...(creature.abilities ?? []).map(actionSource),
  ];
  const casting = creature.spellcasting;
  if (!casting?.enabled) return { sources, missingSpells: [] };
  const entryId = foundry.utils.randomID();
  const { resolved, missing } = await officialSpellSources(casting.spells ?? [], entryId);
  sources.push(spellcastingEntrySource(casting, entryId, resolved));
  sources.push(...resolved.map((spell) => spell.source));
  return { sources, missingSpells: missing };
}

function iwrSource(entry, kind) {
  const object = typeof entry === "string" ? { type: entry } : entry;
  const label = String(object?.type || "custom");
  const type = slug(label);
  const configName = kind === "immunities" ? "immunityTypes" : kind === "weaknesses" ? "weaknessTypes" : "resistanceTypes";
  const configured = CONFIG.PF2E?.[configName] ?? {};
  const known = Object.hasOwn(configured, type);
  const base = {
    type: known ? type : "custom",
    ...(known ? {} : { customLabel: label }),
    exceptions: [],
  };
  if (kind !== "immunities") base.value = number(object?.value);
  if (kind === "resistances") base.doubleVs = [];
  return base;
}

function sensesSource(senses = []) {
  const configured = CONFIG.PF2E?.senses ?? {};
  const precise = new Set(["darkvision", "greater-darkvision", "low-light-vision"]);
  return senses.flatMap((sense) => {
    const text = String(sense);
    const range = text.match(/\b(\d+)\s+feet\b/i)?.[1];
    const type = Object.keys(configured).find((key) => {
      const label = game.i18n.localize(configured[key]);
      return text.toLowerCase().includes(key.replaceAll("-", " ")) || text.toLowerCase().includes(label.toLowerCase());
    }) ?? slug(text.replace(/\b\d+\s+feet\b/gi, "").replace(/\b(precise|imprecise|vague)\b/gi, ""));
    if (Object.keys(configured).length && !Object.hasOwn(configured, type)) return [];
    const statedAcuity = text.match(/\b(precise|imprecise|vague)\b/i)?.[1]?.toLowerCase();
    return [{
      type,
      acuity: statedAcuity ?? (precise.has(type) ? "precise" : "imprecise"),
      range: range ? number(range) : null,
    }];
  });
}

function languageSource(languages = []) {
  const configured = CONFIG.PF2E?.languages ?? {};
  const value = [];
  const custom = [];
  for (const language of languages) {
    const label = String(language?.name || language);
    const key = slug(label);
    if (!Object.keys(configured).length || Object.hasOwn(configured, key)) value.push(key);
    else custom.push(label);
  }
  return { value, details: custom.join(", ") };
}

function descriptionFromCreature(creature) {
  const defenses = creature.defenses ?? {};
  const speeds = (creature.speeds ?? []).map((speed) => `${speed.type} ${speed.feet} feet`).join(", ");
  const specialSkills = (creature.skills ?? [])
    .filter((skill) => skill.specialModifier)
    .map((skill) => `${skill.name} ${skill.specialModifier}`)
    .join("; ");
  const lines = [
    `<p><strong>Perception</strong> ${number(creature.perception?.modifier) >= 0 ? "+" : ""}${number(creature.perception?.modifier)}${creature.perception?.senses?.length ? `; ${htmlEscape(creature.perception.senses.join(", "))}` : ""}</p>`,
    `<p><strong>Speed</strong> ${htmlEscape(speeds || "25 feet")}</p>`,
    specialSkills ? `<p><strong>Special skill modifiers</strong> ${htmlEscape(specialSkills)}</p>` : "",
    defenses.healing?.length ? `<p><strong>Regeneration / Healing</strong> ${automateRulesText(defenses.healing.join(", "))}</p>` : "",
  ];
  return lines.join("");
}

async function actorSource(creature) {
  const skills = Object.fromEntries((creature.skills ?? []).map((skill) => [
    slug(skill.name),
    { base: number(skill.modifier) },
  ]));
  const abilities = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((key) => [
    key,
    { mod: number(creature.abilityModifiers?.[key]) },
  ]));
  const speeds = creature.speeds ?? [];
  const landSpeed = speeds.find((speed) => ["land", "walk", "walking"].includes(String(speed.type).toLowerCase()))?.feet ?? 25;
  const otherSpeeds = speeds
    .filter((speed) => !["land", "walk", "walking"].includes(String(speed.type).toLowerCase()))
    .map((speed) => ({ type: slug(speed.type), value: number(speed.feet) }));
  const defenses = creature.defenses ?? {};
  const languages = languageSource(creature.languages);
  const senses = sensesSource(creature.perception?.senses);
  const { sources: items, missingSpells } = await importedItems(creature);
  return {
    missingSpells,
    source: {
    name: creature.name || "Imported Creature",
    type: "npc",
    system: {
      abilities,
      attributes: {
        ac: { details: "", value: number(defenses.ac) },
        allSaves: { value: "" },
        hp: { details: "", max: number(defenses.hp), temp: 0, value: number(defenses.hp) },
        immunities: (defenses.immunities ?? []).map((entry) => iwrSource(entry, "immunities")),
        weaknesses: (defenses.weaknesses ?? []).map((entry) => iwrSource(entry, "weaknesses")),
        resistances: (defenses.resistances ?? []).map((entry) => iwrSource(entry, "resistances")),
        speed: { details: "", otherSpeeds, value: number(landSpeed, 25) },
      },
      details: {
        blurb: "",
        languages,
        level: { value: number(creature.level) },
        privateNotes: "",
        publicNotes: descriptionFromCreature(creature),
        publication: { license: "ORC", remaster: true, title: "PF2e GM Tool" },
      },
      initiative: { statistic: "perception" },
      perception: {
        details: (creature.perception?.senses ?? []).join(", "),
        mod: number(creature.perception?.modifier),
        senses,
      },
      resources: {},
      saves: {
        fortitude: { saveDetail: "", value: number(defenses.saves?.fortitude) },
        reflex: { saveDetail: "", value: number(defenses.saves?.reflex) },
        will: { saveDetail: "", value: number(defenses.saves?.will) },
      },
      skills,
      traits: {
        rarity: "common",
        size: { value: sizeValue(creature.size) },
        value: splitList(creature.trait).map(slug).filter(Boolean),
      },
    },
    items,
    },
  };
}

async function importCreatureExport(payload) {
  if (!EXPORT_SCHEMAS.has(payload?.schema) || !payload.creature) {
    throw new Error("That text is not a PF2e GM Tool creature export.");
  }
  await loadInlineLinkIndexes();
  const { source, missingSpells } = await actorSource(payload.creature);
  const actor = await Actor.create(source);
  ui.notifications.info(`Imported ${actor.name} as a PF2e NPC.`);
  if (missingSpells.length) {
    ui.notifications.warn(`Could not resolve these names in the active PF2e Compendium Browser: ${missingSpells.join(", ")}`);
  }
  actor.sheet.render(true);
  return actor;
}

async function openImportDialog() {
  let formData;
  try {
    formData = await foundry.applications.api.DialogV2.input({
      window: { title: "Import PF2e GM Tool Creature" },
      content: `
        <p>Copy a finished creature's JSON from PF2e GM Tool, paste it below, and select Import Creature.</p>
        <textarea name="creatureJson" rows="18" style="width:100%; resize:vertical" autofocus placeholder='{ "schema": "pf2e-gm-tool/creature@3", ... }'></textarea>`,
      ok: { label: "Import Creature", icon: "fas fa-file-import" },
      rejectClose: false,
    });
  } catch (_error) {
    return;
  }
  const text = formData?.creatureJson?.trim();
  if (!text) return;
  try {
    await importCreatureExport(JSON.parse(text));
  } catch (error) {
    console.error(`${MODULE_ID} import failed`, error);
    ui.notifications.error(error.message || "Could not import this creature JSON.");
  }
}

function preparedNumber(stat, fallback = null) {
  if (Number.isFinite(Number(stat))) return Number(stat);
  const value = stat?.mod ?? stat?.value ?? stat?.totalModifier ?? stat?.modifier;
  if (value === null || value === undefined || value === "") return fallback;
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function preparedDamage(action, actor) {
  const rolls = action?.damageRolls ?? action?.damage ?? {};
  const prepared = Object.entries(rolls).map(([key, roll]) => ({
    label: roll?.label ?? key,
    formula: roll?.formula ?? roll?.damage ?? String(roll ?? ""),
    type: roll?.type ?? roll?.damageType ?? "",
  })).filter((entry) => entry.formula);
  if (prepared.length) return prepared;

  const itemSystem = action?.item?.system ?? {};
  const damage = itemSystem.damage ?? {};
  const dice = number(damage.dice, 0);
  const die = String(damage.die ?? "");
  if (!dice || !die) return [];
  const traits = itemSystem.traits?.value ?? [];
  const ability = damage.modifier || (action.type === "melee" || itemSystem.range == null || traits.includes("thrown") ? "str" : "");
  const abilityModifier = ability ? preparedNumber(actor.system?.abilities?.[ability], 0) : 0;
  const itemBonus = number(itemSystem.bonusDamage?.value, 0);
  const totalBonus = abilityModifier + itemBonus;
  return [{
    label: "Base damage",
    formula: `${dice}${die} ${totalBonus >= 0 ? "+" : "-"} ${Math.abs(totalBonus)}${ability ? ` (${ability.toUpperCase()})` : ""}`,
    type: damage.damageType ?? "",
  }];
}

async function preparedActorExport(actor) {
  const system = actor.system ?? {};
  const items = [...actor.items];
  let rulesIndex = null;
  try {
    rulesIndex = await loadRulesIndex();
  } catch (error) {
    console.warn(`${MODULE_ID} | Could not load the class rules index.`, error);
  }
  const classItem = items.find((item) => item.type === "class");
  const className = classItem?.name ?? "";
  const strikes = [...(system.actions ?? [])].map((action) => ({
    name: action.label ?? action.name ?? action.item?.name ?? "Unnamed action",
    type: action.type ?? action.item?.type ?? "action",
    actionCost: action.glyph ?? action.cost?.value ?? action.item?.system?.actions?.value ?? action.item?.system?.actionType?.value ?? "",
    modifier: preparedNumber(action, null),
    traits: action.traits ?? action.item?.system?.traits?.value ?? [],
    range: action.range?.increment ?? action.range ?? action.item?.system?.range?.value ?? "",
    reload: action.item?.system?.reload?.value ?? action.item?.system?.reload ?? 0,
    variants: (action.variants ?? [])
      .map((variant) => ({ label: variant.label ?? "", modifier: preparedNumber(variant, null) }))
      .filter((variant) => variant.modifier !== null),
    damage: preparedDamage(action, actor),
    itemId: action.item?.id ?? "",
  }));
  const abilities = deduplicateOwnedRules(
    items.filter((item) => item.type === "action" || item.type === "feat").map((item) => {
      const matchedRule = matchRuleRecord(item, className, rulesIndex);
      const sourceId = foundrySourceId(item);
      const officialSource = Boolean(sourceId);
      return {
        name: item.name,
        slug: item.slug ?? item.system?.slug ?? slug(item.name),
        type: "ability",
        category: item.system?.category ?? item.system?.featType?.value ?? "",
        level: item.system?.level?.value ?? item.level ?? 0,
        actionCost: item.system?.actions?.value ?? item.system?.actionType?.value ?? "passive",
        frequency: item.system?.frequency?.max
          ? `${item.system.frequency.max}/${item.system.frequency.per ?? "day"}`
          : "",
        frequencyState: item.system?.frequency
          ? {
              value: item.system.frequency.value ?? item.system.frequency.max ?? 0,
              max: item.system.frequency.max ?? 0,
              per: item.system.frequency.per ?? "day",
            }
          : null,
        modifier: null,
        traits: item.system?.traits?.value ?? [],
        range: item.system?.range?.value ?? "",
        variants: [],
        damage: Object.values(item.system?.damage ?? {}).map((entry) => ({
          formula: entry.formula ?? "",
          type: entry.type ?? "",
        })).filter((entry) => entry.formula),
        description: matchedRule && officialSource ? "" : item.system?.description?.value ?? "",
        descriptionSource: matchedRule && officialSource ? "rules-library" : "foundry-item",
        itemId: item.id,
        sourceId,
        libraryRef: libraryReference(matchedRule),
        selections: itemSelections(item),
        rules: structuredClone(item.system?.rules ?? []),
      };
    }),
  );
  const inventoryTypes = new Set(["weapon", "armor", "shield", "consumable", "equipment", "treasure", "backpack", "book", "kit", "ammunition"]);
  const inventory = items.filter((item) => inventoryTypes.has(item.type)).map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug ?? item.system?.slug ?? "",
    type: item.type,
    quantity: item.system?.quantity ?? 1,
    equipped: item.system?.equipped?.carryType ?? "",
    invested: item.system?.equipped?.invested ?? null,
    uses: item.system?.uses ? { value: item.system.uses.value ?? 0, max: item.system.uses.max ?? 0 } : null,
    acBonus: item.type === "shield" ? preparedNumber(item.system?.acBonus, 2) : null,
    hardness: item.type === "shield" ? preparedNumber(item.system?.hardness, 0) : null,
    hp: item.type === "shield" ? preparedNumber(item.system?.hp?.max ?? item.system?.hp?.value, 1) : null,
    brokenThreshold: item.type === "shield" ? preparedNumber(item.system?.hp?.brokenThreshold, 1) : null,
    tower: item.type === "shield" && /tower shield/i.test(item.name),
    description: item.system?.description?.value ?? "",
    sourceId: foundrySourceId(item),
    rules: structuredClone(item.system?.rules ?? []),
  }));
  const matchedClass = rulesIndex?.classesBySlug?.get(slug(className)) ?? null;
  const classData = classItem ? {
    id: classItem.id,
    name: classItem.name,
    slug: classItem.slug ?? classItem.system?.slug ?? slug(classItem.name),
    sourceId: foundrySourceId(classItem),
    libraryRef: matchedClass ? {
      library: RULES_LIBRARY_ID,
      id: matchedClass.id,
      kind: "class",
      sourceUrl: matchedClass.sourceUrl ?? "",
      matchBasis: "class-slug",
    } : null,
  } : null;
  let rollOptions = [];
  try {
    rollOptions = [...new Set([
      ...(actor.getRollOptions?.(["all"]) ?? []),
      ...(actor.getRollOptions?.(["self"]) ?? []),
    ])].filter((option) => typeof option === "string").sort();
  } catch {
    rollOptions = [];
  }
  const actorTraits = system.traits?.value ?? [];
  const masterId = actor.master?.id
    ?? system.master?.id
    ?? system.master?.actorId
    ?? actor.flags?.pf2e?.masterId
    ?? null;
  const companionKind = (
    actor.type === "familiar"
      && actorTraits.includes("animal")
      && actorTraits.includes("minion")
  ) || rollOptions.some((option) =>
    option === "self:animal-companion" || option.endsWith(":trait:animal-companion"))
    ? "animal-companion"
    : "";
  const rawSpells = items.filter((item) => item.type === "spell").map((item) => ({
    id: item.id,
    name: item.name,
    rank: item.system?.level?.value ?? 0,
    isCantrip: (item.system?.traits?.value ?? []).includes("cantrip"),
    castTime: item.system?.time?.value ?? "",
    range: item.system?.range?.value ?? "",
    area: item.system?.area?.value ? `${item.system.area.value}-foot ${item.system.area.type ?? "area"}` : "",
    target: item.system?.target?.value ?? "",
    duration: item.system?.duration?.value ?? "",
    defense: item.system?.defense?.save?.statistic ?? "",
    damages: Object.values(item.system?.damage ?? {}).map((damage) => ({ formula: damage.formula ?? "", type: damage.type ?? "" })).filter((damage) => damage.formula),
    traits: item.system?.traits?.value ?? [],
    description: item.system?.description?.value ?? "",
    entryId: item.system?.location?.value ?? "",
  }));
  function preparedSpellcastingStatistic(item) {
    const collection = actor.spellcasting;
    const preparedEntry = collection?.get?.(item.id)
      ?? collection?.contents?.find?.((entry) => entry.id === item.id)
      ?? item;
    const statistic = preparedEntry?.statistic
      ?? item.statistic
      ?? actor.getStatistic?.(item.slug ?? item.id);
    const explicitDc = preparedNumber(statistic?.dc?.value)
      ?? preparedNumber(statistic?.dc)
      ?? preparedNumber(statistic?.difficultyClass)
      ?? preparedNumber(preparedEntry?.dc)
      ?? preparedNumber(item.system?.spelldc?.dc);
    const explicitAttack = preparedNumber(statistic?.check?.mod)
      ?? preparedNumber(statistic?.check?.modifier)
      ?? preparedNumber(statistic?.check)
      ?? preparedNumber(statistic)
      ?? preparedNumber(preparedEntry?.attack)
      ?? preparedNumber(item.system?.spelldc?.value);
    const ability = item.system?.ability?.value ?? "int";
    const proficiencyRank = number(item.system?.proficiency?.value, 1);
    const proficiencyBonus = [0, 2, 4, 6, 8][Math.min(4, Math.max(1, proficiencyRank))];
    const fallbackAttack = number(system.details?.level?.value)
      + proficiencyBonus
      + number(system.abilities?.[ability]?.mod);
    return {
      dc: explicitDc && explicitDc > 0 ? explicitDc : 10 + fallbackAttack,
      attack: explicitAttack !== null && explicitAttack !== 0 ? explicitAttack : fallbackAttack,
    };
  }
  const spellcasting = items.filter((item) => item.type === "spellcastingEntry").map((item) => ({
    ...preparedSpellcastingStatistic(item),
    id: item.id,
    name: item.name,
    tradition: item.system?.tradition?.value ?? "",
    mode: item.system?.prepared?.value ?? "",
    ability: item.system?.ability?.value ?? "",
    proficiency: item.system?.proficiency?.value ?? 0,
    slots: Object.entries(item.system?.slots ?? {}).map(([rank, slot]) => ({ rank, value: slot.value ?? 0, max: slot.max ?? 0 })),
  }));
  const spellcastingById = new Map(spellcasting.map((entry) => [entry.id, entry]));
  const spells = rawSpells.map((spell) => {
    const entry = spellcastingById.get(spell.entryId);
    return {
      ...spell,
      spellDc: entry?.dc ?? null,
      spellAttack: entry?.attack ?? null,
    };
  });
  return {
    schema: "pf2e-gm-tool/character@2",
    exportedAt: new Date().toISOString(),
    source: "Foundry VTT PF2e prepared actor",
    rulesLibrary: {
      id: RULES_LIBRARY_ID,
      indexSchema: rulesIndex?.schema ?? null,
      generatedAt: rulesIndex?.generatedAt ?? null,
      available: Boolean(rulesIndex),
    },
    character: {
      id: actor.id,
      name: actor.name,
      type: actor.type,
      image: actor.img,
      level: system.details?.level?.value ?? 0,
      hp: { value: system.attributes?.hp?.value ?? 0, max: system.attributes?.hp?.max ?? 0, temp: system.attributes?.hp?.temp ?? 0 },
      ac: preparedNumber(system.attributes?.ac),
      perception: preparedNumber(system.perception),
      initiative: system.initiative?.statistic ?? "perception",
      saves: {
        fortitude: preparedNumber(system.saves?.fortitude),
        reflex: preparedNumber(system.saves?.reflex),
        will: preparedNumber(system.saves?.will),
      },
      speeds: Object.entries(system.attributes?.speed?.otherSpeeds ?? {}).map(([type, speed]) => ({ type, value: preparedNumber(speed) ?? speed?.value ?? 0 })).concat([{ type: "land", value: system.attributes?.speed?.value ?? 0 }]),
      languages: system.details?.languages?.value ?? [],
      abilityModifiers: Object.fromEntries(
        Object.entries(system.abilities ?? {}).map(([ability, data]) => [ability, preparedNumber(data, 0)]),
      ),
      class: classData,
      skills: Object.entries(system.skills ?? {}).map(([slug, skill]) => ({ slug, label: skill.label ?? slug, modifier: preparedNumber(skill), rank: skill.rank ?? 0 })),
      actions: [...strikes, ...abilities],
      classRules: {
        classRef: classData?.libraryRef ?? null,
        featureRefs: abilities
          .filter((ability) => ability.libraryRef?.kind?.startsWith("class_feature"))
          .map((ability) => ability.libraryRef),
        featRefs: abilities
          .filter((ability) => ability.libraryRef?.kind?.endsWith("_feat"))
          .map((ability) => ability.libraryRef),
        unresolvedItems: abilities
          .filter((ability) => !ability.libraryRef)
          .map((ability) => ({
            itemId: ability.itemId,
            sourceId: ability.sourceId,
            name: ability.name,
            slug: ability.slug,
            category: ability.category,
            level: ability.level,
          })),
      },
      spells,
      spellcasting,
      items: inventory,
      rollOptions,
      relations: {
        summonerId: null,
        masterId,
        companionKind,
      },
      traits: actorTraits,
      immunities: system.attributes?.immunities ?? [],
      weaknesses: system.attributes?.weaknesses ?? [],
      resistances: system.attributes?.resistances ?? [],
      effects: [...actor.effects].map((effect) => ({ name: effect.name, disabled: effect.disabled, duration: effect.duration })),
    },
  };
}

async function downloadCharacterExport(actor) {
  const payload = await preparedActorExport(actor);
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `pf2e-gm-tool-character-${slug(actor.name) || actor.id}.json`;
  link.click();
  URL.revokeObjectURL(url);
  const wired = payload.character.classRules.featureRefs.length + payload.character.classRules.featRefs.length;
  const unresolved = payload.character.classRules.unresolvedItems.length;
  ui.notifications.info(`Exported ${actor.name}: ${wired} rules wired to the class library${unresolved ? `, ${unresolved} kept inline` : ""}.`);
}

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.warn("PF2e GM Tool Creature Importer requires the PF2e system.");
    return;
  }
  game.pf2eGmToolImporter = { importCreatureExport, openImportDialog, preparedActorExport, downloadCharacterExport };
});

function addImportButton(html) {
  if (game.system.id !== "pf2e" || !game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element;
  if (!root || root.querySelector(`[data-${MODULE_ID}-import]`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(`data-${MODULE_ID}-import`, "true");
  button.className = "pf2e-gm-import-button";
  button.innerHTML = '<i class="fas fa-file-import"></i> Import PF2e GM Tool Creature';
  button.addEventListener("click", openImportDialog);
  const header = root.querySelector(".directory-header, [data-application-part='header'], header") ?? root;
  header.prepend(button);
}

function addCharacterExportButton(html, actor) {
  if (game.system.id !== "pf2e" || !game.user.isGM || !actor || !["character", "npc", "familiar"].includes(actor.type)) return;
  const root = html instanceof HTMLElement ? html : html?.[0] ?? html?.element;
  if (!root || root.querySelector(`[data-${MODULE_ID}-character-export]`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute(`data-${MODULE_ID}-character-export`, "true");
  button.className = "pf2e-gm-export-button";
  button.innerHTML = '<i class="fas fa-file-export"></i> Export for PF2e GM Tool';
  button.addEventListener("click", () => downloadCharacterExport(actor));
  const header = root.querySelector(".window-header, [data-application-part='header'], header") ?? root;
  header.append(button);
}

Hooks.on("renderActorDirectory", (_app, html) => addImportButton(html));
Hooks.on("renderApplicationV2", (app, html) => {
  if (app?.tabName === "actors" || app?.constructor?.name === "ActorDirectory") addImportButton(html);
});
Hooks.on("renderActorSheet", (app, html) => addCharacterExportButton(html, app.actor));
Hooks.on("renderApplicationV2", (app, html) => {
  if (app?.actor) addCharacterExportButton(html, app.actor);
});

Hooks.on("getActorDirectoryEntryContext", (_html, options) => {
  if (!game.user.isGM) return;
  options.push({
    name: "Import PF2e GM Tool Creature",
    icon: '<i class="fas fa-file-import"></i>',
    callback: () => openImportDialog(),
  });
  options.push({
    name: "Export for PF2e GM Tool",
    icon: '<i class="fas fa-file-export"></i>',
    condition: (li) => {
      const actor = game.actors.get(li.dataset.documentId);
      return actor && ["character", "npc", "familiar"].includes(actor.type);
    },
    callback: (li) => {
      const actor = game.actors.get(li.dataset.documentId);
      if (actor) downloadCharacterExport(actor);
    },
  });
});
