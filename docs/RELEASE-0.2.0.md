# AI Box 0.2.0

- Add a vault-owned maintenance dashboard: daily inbox increments, weekly whole-vault structure plus incremental content review, and monthly batched full content review.
- Show executor, external task registration, last-success evidence, failure, and overdue status without treating a saved plan as an active schedule.
- Generate external scheduling and immediate/catch-up instructions. Background wake-up remains the external tool's responsibility.
- Preserve unknown plan fields; reject malformed plans, changes made by another worker, and plan writes during maintenance.
- Include an optional Python worker-record helper with exclusive locks, token ownership, evidence checks, and failure history preservation.
- Make the post-apply capture mode explicit in the agent connection preview.

Desktop only, Obsidian 1.13.0+. No network requests, model calls or telemetry. Existing vault notes and agent settings are not changed automatically on plugin startup. Install the three release files in `.obsidian/plugins/ai-box/`, preserving `data.json`, then reload the plugin.
