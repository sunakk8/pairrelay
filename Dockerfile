# syntax=docker/dockerfile:1

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.11.0 --activate
WORKDIR /app

FROM base AS build
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/relay/package.json packages/relay/
COPY packages/shared/tsconfig.json packages/shared/
COPY packages/relay/tsconfig.json packages/relay/
RUN pnpm install --frozen-lockfile --filter @pairrelay/relay...

COPY packages/shared/src packages/shared/src
COPY packages/relay/src packages/relay/src
RUN pnpm --filter @pairrelay/relay... build
RUN pnpm deploy --filter=@pairrelay/relay --prod --legacy /prod

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PAIRRELAY_RELAY_HOST=0.0.0.0

COPY --from=build /prod ./

EXPOSE 8787

CMD ["node", "dist/index.js"]
