# PF2e GM Tool Creature Importer

This Foundry VTT module imports the JSON copied from a finished creature sheet in PF2e GM Tool and exports prepared PF2e character data back to the desktop app.

## Use

1. In PF2e GM Tool, open a finished creature and select **Copy JSON**.
2. In Foundry with the PF2e system and this module enabled, open the **Actors** sidebar and select **Import PF2e GM Tool Creature**. If a theme hides the header control, right-click any actor entry and select the same command.
3. Paste the copied JSON into the import window and select **Import Creature**.

The importer creates native PF2e data:

- Strikes appear in the NPC sheet's **Attacks** section, with working attack and damage rolls.
- Spellcasters receive a real spellcasting entry. Each selected spell is resolved through PF2e's active Compendium Browser spell index, including localized and original names, and embedded with its official PF2e data.
- Cantrips and rank-1 spells are separate. Prepared cantrips are placed in PF2e's native `slot0` cantrip group, where Foundry manages their automatic heightening; rank-1 spells use rank-1 slots normally.
- Custom or unmatched spell names are skipped with a warning instead of being created as custom Foundry spell items.
- Abilities retain their passive, one-, two-, three-, reaction-, or free-action cost and PF2e action icon.
- Saves, damage, conditions, and common actions in descriptions become PF2e inline controls and draggable links.
- Bursts, cones, lines, emanations, and plain ranges receive measured-template controls.
- AC, HP, saves, skills, senses, languages, speeds, immunities, weaknesses, and resistances are placed in their native NPC fields.

The module is intended for Foundry VTT 13 and the PF2e system. It accepts the portable export schemas `pf2e-gm-tool/creature@1`, `pf2e-gm-tool/creature@2`, and `pf2e-gm-tool/creature@3`.

## Development

Package the contents of this folder with `module.json` at the ZIP root as `pf2e-gm-tool-importer.zip`.
## Exporting party characters

Open a PC or NPC sheet in Foundry and choose **Export for PF2e GM Tool** from the sheet header. You can also right-click the actor in the Actors directory and select the same command.

The downloaded JSON contains Foundry's prepared values: AC, HP, saves, perception, skills, strike modifiers and MAP variants, damage formulas, spellcasting, spells, actions, effects, speeds, and defenses. Import that file in the desktop app's **Characters** tab.
