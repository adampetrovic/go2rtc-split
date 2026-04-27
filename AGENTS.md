# AGENTS.md

## Project overview

go2rtc Split is a TypeScript/Vite PWA plus a small Node.js static server. It displays multiple go2rtc WebRTC streams under a configurable base path, defaulting to `/split`.

## Commands

```bash
npm install
npm run check
npm test
npm run build
```

Use `npm run dev` for Vite development and `npm run preview` for the production Node server.

## Conventions

- Keep runtime behaviour configurable through environment variables in `server/config.ts` and `src/shared/config.ts`.
- Do not commit `dist/` or `node_modules/`.
- The default mount path is `/split`; update tests and docs if it changes.
- The app is intended to use same-origin go2rtc WebSocket signalling at `/api/ws`.
