# Spin & Wheel platform — one container: API + WebSocket + built frontend.
# Needs Node >= 22.13 (built-in SQLite). Not yet exercised in CI: build and smoke-test it before relying on it.
FROM node:24-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production SERVER_PORT=8787 DB_PATH=/data/spinwheel.db BACKUP_DIR=/data/backups TRUST_PROXY=1
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY server ./server
COPY --from=build /app/dist ./dist
RUN mkdir -p /data && chown -R node:node /data
VOLUME /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=15s --timeout=3s CMD node -e "fetch('http://127.0.0.1:8787/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--experimental-strip-types", "--disable-warning=ExperimentalWarning", "server/main.ts"]
