# syntax=docker/dockerfile:1
# Один Dockerfile для всех образов проекта. Контекст сборки — корень репозитория.
FROM node:22-bookworm-slim AS build
ENV CI=true
RUN corepack enable
WORKDIR /repo
# 1) Зависимости. Слой зависит только от lockfile и корневых манифестов, поэтому при
#    обновлении, где менялся только код, пакеты не скачиваются заново (берутся из кэша слоя).
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
# 2) Исходники и установка из локального хранилища (без сети)
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm -r --workspace-concurrency=1 build
# Готовые к запуску каталоги с production-зависимостями
RUN pnpm --filter @vpn/api deploy --legacy --prod /out/api \
 && pnpm --filter @vpn/bot deploy --legacy --prod /out/bot \
 && test -f /out/api/dist/server.js && test -f /out/api/dist/worker.js && test -f /out/api/dist/cli.js \
 && test -d /out/api/dist/migrations && test -f /out/bot/dist/index.js

FROM node:22-bookworm-slim AS api
LABEL com.docker.compose.project=vpn
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/api /app
USER node
# Проверяем доступ именно от runtime-пользователя, а не root сборочного этапа.
RUN node -e "const fs=require('node:fs'); for(const name of fs.readdirSync('/app/dist/migrations')) if(name.endsWith('.sql')) fs.readFileSync('/app/dist/migrations/'+name); fs.readFileSync('/app/dist/server.js')"
# Проверяем, что нативный декодер фото работает в production от пользователя node.
RUN node --input-type=module -e "import sharp from 'sharp'; await sharp({create:{width:1,height:1,channels:3,background:'#ffffff'}}).jpeg().toBuffer()"
EXPOSE 3000
CMD ["node", "dist/server.js"]

FROM node:22-bookworm-slim AS bot
LABEL com.docker.compose.project=vpn
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out/bot /app
USER node
RUN node -e "require('node:fs').readFileSync('/app/dist/index.js')"
EXPOSE 3001
CMD ["node", "dist/index.js"]

FROM caddy:2-alpine AS gateway
LABEL com.docker.compose.project=vpn
COPY --from=build /repo/apps/app/dist /srv/app
COPY --from=build /repo/apps/admin/dist /srv/admin
COPY deploy/Caddyfile /etc/caddy/Caddyfile
# Статические файлы должны читаться независимо от прав исходного архива.
RUN chmod -R a+rX /srv/app /srv/admin
