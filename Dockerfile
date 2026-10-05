# syntax=docker/dockerfile:1.7

FROM node:24.14-alpine AS dependencies

WORKDIR /app

ENV HUSKY=0

RUN corepack enable \
    && corepack prepare pnpm@11.0.0 --activate \
    && apk add --no-cache python3 make g++

# Dependency installation and Prisma generation never need runtime secrets.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY prisma/schema.prisma ./prisma/schema.prisma
RUN pnpm install --frozen-lockfile \
    && pnpm prune --prod --ignore-scripts

FROM node:24.14-alpine AS listener

WORKDIR /app

ENV NODE_ENV=production

# The runtime contains only the listener sources and production dependencies.
# Secrets are supplied when the container starts with Docker's --env-file.
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json tsconfig.json sentry.server.config.ts ./
COPY --chown=node:node src/abi ./src/abi
COPY --chown=node:node src/backend ./src/backend
COPY --chown=node:node src/lib/env.ts ./src/lib/env.ts
COPY --chown=node:node src/lib/marketRecommendations.ts ./src/lib/marketRecommendations.ts
COPY --chown=node:node src/lib/rpc ./src/lib/rpc
COPY --chown=node:node src/types/design.ts ./src/types/design.ts

USER node

# Resolve the database service's runtime imports before publishing the image.
# Prisma creates its client lazily; this placeholder does not connect to a DB.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build \
    ./node_modules/.bin/tsx -e 'import("./src/backend/services/databaseService.ts").then(() => console.log("Listener database imports OK"))'

STOPSIGNAL SIGTERM

CMD ["./node_modules/.bin/tsx", "src/backend/listener/index.ts"]
