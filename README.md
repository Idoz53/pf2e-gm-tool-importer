# PF2e GM Tool Creature Importer

This Foundry VTT module imports the JSON copied from a finished creature sheet in PF2e GM Tool.

## Use

1. In PF2e GM Tool, open a finished creature and select **Copy JSON**.
2. In Foundry with the PF2e system and this module enabled, open the **Actors** sidebar and select **Import PF2e GM Tool Creature**. If a theme hides the header control, right-click any actor entry and select the same command.
3. Paste the copied JSON into the import window and select **Import Creature**. The module creates a PF2e NPC, imports core statistics, and adds strikes, abilities, and spells as readable action entries.

The module is intended for Foundry VTT 13 and the PF2e system. It uses the portable export schema `pf2e-gm-tool/creature@1`.

## Development

Package the contents of this folder (with `module.json` at the ZIP root) as `pf2e-gm-tool-importer.zip`, attach it to a GitHub release tagged `v0.1.0`, and keep the release URLs in `module.json` aligned with that release.
