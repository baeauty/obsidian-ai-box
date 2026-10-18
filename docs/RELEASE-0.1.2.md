# AI Box 0.1.2

Desktop-only release for Obsidian 1.13.0 or later.

- Initialize an empty local knowledge base, or connect an existing vault without changing its notes.
- Connect DeepSeek Harness, Claude Code, and Codex through their global instruction files. No MCP service is required.
- Preview every external instruction change, save a local backup, disconnect, or undo an unchanged operation.
- Keep automatic knowledge capture opt-in, preserve unrelated instructions, and reject conflicting edits.
- Add searchable settings definitions, strict local-data validation, and official Obsidian lint checks.

The plugin makes no network requests and collects no telemetry. It accesses selected global instruction files outside the vault only to configure the agent connection and store local recovery data. The agent still controls its own filesystem permissions.

## Install manually

Create `.obsidian/plugins/ai-box/` inside your vault and place the three release attachments there: `main.js`, `manifest.json`, and `styles.css`. Enable AI Box, then open its settings. Existing vaults can connect directly; template creation is optional.

The community-directory listing is submitted separately and is only installable in the market after the official publishing process is complete. Automated tests and build checks do not imply that every agent version or configuration has been validated.
