# syntax=docker/dockerfile:1.7

FROM node:24-alpine AS build
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    BASE_PATH=/split
WORKDIR /app

RUN addgroup -S app && adduser -S app -G app

COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./package.json

USER app
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server/server.js"]
