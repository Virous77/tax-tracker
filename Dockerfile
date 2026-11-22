FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update && apt-get install -y --no-install-recommends g++ make python3 \
    && rm -rf /var/lib/apt/lists/* \
    && corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/vault/package.json ./packages/vault/package.json
COPY packages/prices/package.json ./packages/prices/package.json
COPY packages/sync/package.json ./packages/sync/package.json
COPY packages/evm/package.json ./packages/evm/package.json
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
RUN mkdir -p apps/web/public && pnpm -r build

FROM node:24-bookworm-slim@sha256:dc26ae92c9fb15cf6b1d63e20f0944b2efe0f115b20e00be48fb23fceb061c54 AS runner
ARG VERSION
ARG REVISION
ARG REPOSITORY_URL
LABEL org.opencontainers.image.title="tax-tracker" \
      org.opencontainers.image.description="Self-hosted Indian crypto & US stock tax helper" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.source="${REPOSITORY_URL}"
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 DATA_DIR=/data HOSTNAME=0.0.0.0
RUN mkdir /data && chown node:node /data
COPY --chown=node:node LICENSE ./LICENSE
COPY --from=build --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=build --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build --chown=node:node /app/apps/web/public ./apps/web/public
COPY --from=build --chown=node:node /app/packages/db/migrations ./packages/db/migrations
COPY --from=build --chown=node:node /app/packages/rates/data ./packages/rates/data
COPY scripts/docker-entrypoint.mjs ./scripts/docker-entrypoint.mjs
VOLUME /data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT || 3000)+'/api/health').then(async r=>{if(!r.ok||!(await r.json()).dbOk)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "scripts/docker-entrypoint.mjs"]
