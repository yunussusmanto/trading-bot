# Version Auto-Update Rule

<RULE[version_auto_update]>
1. Every time any code change, feature update, or bugfix is made to `trading-bot`:
   - Automatically bump the version number string in `dashboard/index.html` (e.g. `ROBOT PRO v4.0.8` -> `ROBOT PRO v4.0.9` -> `ROBOT PRO v4.1.0`).
   - Mention the updated version badge in the response and commit message.
</RULE[version_auto_update]>
