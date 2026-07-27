const MODULE_ID = "pf2e-gm-tool-importer";
const EXPORT_SCHEMA = "pf2e-gm-tool/creature@1";

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
  const sizes = { tiny: "tiny", sm: "sm", small: "sm", med: "med", medium: "med", lg: "lg", large: "lg", huge: "huge", grg: "grg", gargantuan: "grg" };
  return sizes[String(size).toLowerCase()] ?? "med";
}

function slug(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function descriptionFromCreature(creature) {
  const defenses = creature.defenses ?? {};
  const speeds = (creature.speeds ?? []).map((speed) => `${speed.type} ${speed.feet} feet`).join(", ");
  const lines = [
    `<p><strong>Perception</strong> +${number(creature.perception?.modifier)}${creature.perception?.senses?.length ? `; ${creature.perception.senses.join(", ")}` : ""}</p>`,
    `<p><strong>Languages</strong> ${(creature.languages ?? []).map((language) => language.name).join(", ") || "None"}</p>`,
    `<p><strong>Speed</strong> ${speeds || "25 feet"}</p>`,
    `<p><strong>Immunities</strong> ${(defenses.immunities ?? []).map((entry) => typeof entry === "string" ? entry : `${entry.type} ${entry.value ?? ""}`).join(", ") || "None"}</p>`,
    `<p><strong>Weaknesses</strong> ${(defenses.weaknesses ?? []).map((entry) => typeof entry === "string" ? entry : `${entry.type} ${entry.value ?? ""}`).join(", ") || "None"}</p>`,
    `<p><strong>Resistances</strong> ${(defenses.resistances ?? []).map((entry) => typeof entry === "string" ? entry : `${entry.type} ${entry.value ?? ""}`).join(", ") || "None"}</p>`,
  ];
  return lines.join("\n");
}

function actionSource(name, description, category = "offensive") {
  return {
    name,
    type: "action",
    system: {
      category,
      actionType: { value: "action" },
      actions: { value: 1 },
      traits: { value: [] },
      description: { value: description },
    },
  };
}

function actionSources(creature) {
  const sources = [];
  for (const strike of creature.strikes ?? []) {
    sources.push(actionSource(
      strike.name || "Strike",
      `<p><strong>Strike</strong> +${number(strike.attack)} (${htmlEscape(strike.traits || "")})</p><p><strong>Damage</strong> ${htmlEscape(strike.damage || "")} ${htmlEscape(strike.damageType || "")}</p>`,
    ));
  }
  for (const ability of creature.abilities ?? []) {
    sources.push(actionSource(ability.name || "Ability", `<p>${htmlEscape(ability.description || "")}</p>`));
  }
  if (creature.spellcasting?.enabled) {
    const spells = creature.spellcasting.spells ?? [];
    const casting = creature.spellcasting;
    sources.push(actionSource(
      `${casting.tradition || "Arcane"} Spellcasting`,
      `<p><strong>Spell DC</strong> ${number(casting.dc)}; <strong>spell attack</strong> +${number(casting.attack)}</p>`,
      "interaction",
    ));
    for (const spell of spells) {
      sources.push(actionSource(
        `${spell.name || "Spell"} (Rank ${number(spell.rank)})`,
        `<p>${htmlEscape(spell.description || "Imported spell")}</p>${spell.sourceUrl ? `<p><a href="${htmlEscape(spell.sourceUrl)}" target="_blank">Archives of Nethys</a></p>` : ""}`,
        "interaction",
      ));
    }
  }
  return sources;
}

function actorSource(creature) {
  const skills = Object.fromEntries((creature.skills ?? []).map((skill) => [slug(skill.name), { base: number(skill.modifier) }]));
  const abilities = Object.fromEntries(["str", "dex", "con", "int", "wis", "cha"].map((key) => [key, { mod: number(creature.abilityModifiers?.[key]) }]));
  const landSpeed = (creature.speeds ?? []).find((speed) => String(speed.type).toLowerCase() === "land")?.feet ?? 25;
  return {
    name: creature.name || "Imported Creature",
    type: "npc",
    system: {
      details: { level: { value: number(creature.level) }, publicNotes: { value: descriptionFromCreature(creature) } },
      traits: { size: { value: sizeValue(creature.size) }, value: [slug(creature.trait)] },
      abilities,
      perception: { mod: number(creature.perception?.modifier) },
      saves: {
        fortitude: { value: number(creature.defenses?.saves?.fortitude) },
        reflex: { value: number(creature.defenses?.saves?.reflex) },
        will: { value: number(creature.defenses?.saves?.will) },
      },
      skills,
      attributes: {
        ac: { value: number(creature.defenses?.ac) },
        hp: { value: number(creature.defenses?.hp), max: number(creature.defenses?.hp) },
        speed: { value: number(landSpeed, 25) },
      },
    },
    items: actionSources(creature),
  };
}

async function importCreatureExport(payload) {
  if (payload?.schema !== EXPORT_SCHEMA || !payload.creature) {
    throw new Error("That file is not a PF2e GM Tool creature export.");
  }
  const actor = await Actor.create(actorSource(payload.creature));
  ui.notifications.info(`Imported ${actor.name} as a PF2e NPC.`);
  actor.sheet.render(true);
  return actor;
}

function openFilePicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      await importCreatureExport(JSON.parse(await file.text()));
    } catch (error) {
      console.error(`${MODULE_ID} import failed`, error);
      ui.notifications.error(error.message || "Could not import this creature JSON.");
    }
  });
  input.click();
}

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.warn("PF2e GM Tool Creature Importer requires the PF2e system.");
    return;
  }
  game.pf2eGmToolImporter = { importCreatureExport, openFilePicker };
});

Hooks.on("renderActorDirectory", (_app, html) => {
  if (game.system.id !== "pf2e") return;
  const root = html instanceof HTMLElement ? html : html[0];
  if (!root || root.querySelector(`[data-${MODULE_ID}-import]`)) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset[`${MODULE_ID}Import`] = "true";
  button.className = "pf2e-gm-import-button";
  button.innerHTML = '<i class="fas fa-file-import"></i> Import PF2e GM Tool Creature';
  button.addEventListener("click", openFilePicker);
  (root.querySelector(".directory-header") ?? root).prepend(button);
});
