# AGENTS.md — go2rtc-split

## Project Scope

Small web UI for splitting/viewing go2rtc streams.

## Operating Rules

- Keep `/api/ws` and `/split` contracts compatible with the current source/configuration.
- Run the relevant checks before reporting completion.
- Preserve unrelated work and inspect status before editing.

## Commands

```bash
npm install
npm run check
npm test
npm run build
```

If any command overlaps another, report what was run and why. The previous prompt is preserved in `docs/agent/original-agents.md` for reference.
