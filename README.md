# PF2e GM Tool Creature Importer

This Foundry VTT module imports the JSON copied from a finished creature sheet in PF2e GM Tool.

## Use

1. In PF2e GM Tool, open a finished creature and select **Copy JSON**.
2. In Foundry with the PF2e system and this module enabled, open the **Actors** sidebar and select **Import PF2e GM Tool Creature**. If a theme hides the header control, right-click any actor entry and select the same command.
3. Paste the copied JSON into the import window and select **Import Creature**.

The importer creates native PF2e data:

- Strikes appear in the NPC sheet's **Attacks** section, with working attack and damage rolls.
- Spellcasters receive a real spellcasting entry, and imported spells appear in **Spells**.
- Abilities retain their passive, one-, two-, three-, reaction-, or free-action cost and PF2e action icon.
- Saves, damage, conditions, and common actions in descriptions become PF2e inline controls and draggable links.
- Bursts, cones, lines, emanations, and plain ranges receive measured-template controls.
- AC, HP, saves, skills, senses, languages, speeds, immunities, weaknesses, and resistances are placed in their native NPC fields.

The module is intended for Foundry VTT 13 and the PF2e system. It accepts the portable export schemas `pf2e-gm-tool/creature@1` and `pf2e-gm-tool/creature@2`.

## Development

Package the contents of this folder with `module.json` at the ZIP root as `pf2e-gm-tool-importer.zip`.
