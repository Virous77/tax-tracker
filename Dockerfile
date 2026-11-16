FROM node:24-bookworm-slim AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable && corepack prepare pnpm@12.18.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/core/package.json ./packages/core/package.json
COPY packages/rules/package.json ./packages/rules/package.json
COPY packages/engine/package.json ./packages/engine/package.json
COPY packages/rates/package.json ./packages/rates/package.json
COPY packages/db/package.json ./packages/db/package.json
COPY packages/importers/package.json ./packages/importers/package.json
COPY packages/recipes/package.json ./packages/recipes/package.json
COPY apps/cli/package.json ./apps/cli/package.json
COPY apps/web/package.json ./apps/web/package.json
RUN --mount=type=cache,id=tax-tracker-pnpm,target=/root/.local/share/pnpm/store pnpm install --frozen-lockfile
COPY packages ./packages
COPY apps ./apps
COPY tsconfig.base.json ./
RUN pnpm -r build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data HOSTNAME=0.0.0.0 PORT=3000
RUN mkdir /data && chown node:node /data
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=node:node /app/packages/rates/data ./packages/rates/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(async r=>{if(!r.ok||!(await r.json()).dbOk)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]
