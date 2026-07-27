const MODULE_ID = "pf2e-gm-tool-importer";
const EXPORT_SCHEMAS = new Set([
  "pf2e-gm-tool/creature@1",
  "pf2e-gm-tool/creature@2",
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
  const match = text.match(/\b(\d+)[-\s]?foot(?:-\w+)?\s+(burst|cone|line|emanation)\b/i);
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

function spellActionValue(value) {
  const cost = normalizeActionCost(value);
  if (["1", "2", "3"].includes(cost)) return cost;
  if (cost === "reaction") return "reaction";
  if (cost === "free") return "free";
  return String(value || "2");
}

function spellDamage(description = "", components = []) {
  const results = {};
  const pattern = new RegExp(`\\b(\\d+d\\d+(?:\\s*[+-]\\s*\\d+)?)\\s+(${DAMAGE_TYPES.join("|")})\\s+damage\\b`, "gi");
  for (const match of description.matchAll(pattern)) {
    const key = String(Object.keys(results).length);
    results[key] = {
      applyMod: false,
      category: null,
      formula: match[1].replace(/\s+/g, ""),
      kinds: ["damage"],
      materials: [],
      type: match[2].toLowerCase(),
    };
  }
  for (const component of components) {
    if (!["single", "area"].includes(component.type) || !component.value) continue;
    const key = String(Object.keys(results).length);
    const damageType = DAMAGE_TYPES.find((type) => new RegExp(`\\b${type}\\b`, "i").test(component.label || "")) ?? "untyped";
    results[key] = {
      applyMod: false,
      category: null,
      formula: String(component.value),
      kinds: ["damage"],
      materials: [],
      type: damageType,
    };
  }
  return results;
}

function spellDefense(...values) {
  const text = values.filter(Boolean).join(" ");
  const match = text.match(/\b(?:DC\s*\d+\s+)?(basic\s+)?(Fortitude|Reflex|Will)\s+save\b/i)
    ?? text.match(/\b(Fortitude|Reflex|Will)\b(?:\s+save)?/i);
  if (!match) return null;
  const statistic = (match[2] || match[1]).toLowerCase();
  return { save: { basic: Boolean(match[1] && match[2]), statistic } };
}

function spellSource(spell, entryId, id) {
  const area = parseArea(spell.range, spell.target, spell.description);
  const traditions = splitList(spell.traditions).map(slug);
  const traits = traitValues(spell.traits, [...traditions, "arcane", "divine", "occult", "primal"]);
  const rangeText = String(spell.range || "").split(";")[0].replace(/^range\s*/i, "").trim();
  return {
    _id: id,
    name: spell.name || "Spell",
    type: "spell",
    img: "systems/pf2e/icons/default-icons/spell.svg",
    system: {
      area: area ? { type: area.type, value: area.value } : null,
      cost: { value: "" },
      counteraction: false,
      damage: spellDamage(spell.description, spell.components),
      defense: spellDefense(spell.target, spell.description),
      description: {
        value: richDescription(spell.description, {
          range: spell.range,
          target: spell.target,
          components: spell.components,
          sourceUrl: spell.sourceUrl,
        }),
      },
      duration: { sustained: false, value: "" },
      level: { value: Math.max(1, number(spell.rank, 1)) },
      location: { heightenedLevel: Math.max(1, number(spell.rank, 1)), value: entryId },
      publication: { license: "ORC", remaster: true, title: "PF2e GM Tool" },
      range: { value: rangeText },
      requirements: "",
      rules: [],
      slug: null,
      target: { value: String(spell.target || "") },
      time: { value: spellActionValue(spell.actions) },
      traits: { rarity: "common", traditions, value: traits },
    },
  };
}

function spellcastingEntrySource(casting, entryId, preparedSpells) {
  const modeAliases = { prepared: "prepared", spontaneous: "spontaneous", innate: "innate" };
  const mode = modeAliases[String(casting.mode || "").toLowerCase()] ?? "prepared";
  const slots = {};
  for (let rank = 1; rank <= 10; rank += 1) {
    const spells = preparedSpells.filter((spell) => number(spell.rank) === rank);
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

function importedItems(creature) {
  const sources = [
    ...(creature.strikes ?? []).map(strikeSource),
    ...(creature.abilities ?? []).map(actionSource),
  ];
  const casting = creature.spellcasting;
  if (!casting?.enabled) return sources;
  const entryId = foundry.utils.randomID();
  const preparedSpells = (casting.spells ?? []).map((spell) => ({
    spell,
    id: foundry.utils.randomID(),
    rank: number(spell.rank, 1),
  }));
  sources.push(spellcastingEntrySource(casting, entryId, preparedSpells));
  sources.push(...preparedSpells.map(({ spell, id }) => spellSource(spell, entryId, id)));
  return sources;
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

function actorSource(creature) {
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
  return {
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
    items: importedItems(creature),
  };
}

async function importCreatureExport(payload) {
  if (!EXPORT_SCHEMAS.has(payload?.schema) || !payload.creature) {
    throw new Error("That text is not a PF2e GM Tool creature export.");
  }
  await loadInlineLinkIndexes();
  const actor = await Actor.create(actorSource(payload.creature));
  ui.notifications.info(`Imported ${actor.name} as a PF2e NPC.`);
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
        <textarea name="creatureJson" rows="18" style="width:100%; resize:vertical" autofocus placeholder='{ "schema": "pf2e-gm-tool/creature@2", ... }'></textarea>`,
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

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.warn("PF2e GM Tool Creature Importer requires the PF2e system.");
    return;
  }
  game.pf2eGmToolImporter = { importCreatureExport, openImportDialog };
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

Hooks.on("renderActorDirectory", (_app, html) => addImportButton(html));
Hooks.on("renderApplicationV2", (app, html) => {
  if (app?.tabName === "actors" || app?.constructor?.name === "ActorDirectory") addImportButton(html);
});

Hooks.on("getActorDirectoryEntryContext", (_html, options) => {
  if (!game.user.isGM) return;
  options.push({
    name: "Import PF2e GM Tool Creature",
    icon: '<i class="fas fa-file-import"></i>',
    callback: () => openImportDialog(),
  });
});
