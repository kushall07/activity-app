# syntax=docker/dockerfile:1.7
# Build from the repo root:  docker build -f apps/workers/Dockerfile -t activity-workers .
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /repo

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json .npmrc tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY packages/search/package.json packages/search/
COPY apps/workers/package.json apps/workers/
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts --filter @activity/workers...
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/search packages/search
COPY apps/workers apps/workers
RUN pnpm --filter @activity/workers... run build \
 && pnpm --filter @activity/workers deploy --prod --legacy /out

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
CMD ["node", "dist/main.js"]
