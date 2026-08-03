# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=22.23.2

FROM node:${NODE_VERSION}-bookworm-slim AS base
WORKDIR /app

ENV NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*

FROM base AS dependencies

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

FROM dependencies AS development

ENV NODE_ENV=development

COPY --chown=node:node . .

USER node
EXPOSE 3000
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

FROM dependencies AS builder

ARG APP_BUILD_SHA="unknown"

ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build?schema=public \
    APP_BUILD_SHA=${APP_BUILD_SHA}

COPY . .

RUN npm run prisma:generate
RUN npm run build
RUN rm -rf .next/cache \
    && npm cache clean --force

FROM base AS runtime

ARG APP_BUILD_SHA="unknown"

ENV APP_BUILD_SHA=${APP_BUILD_SHA} \
    HOSTNAME=0.0.0.0 \
    NODE_ENV=production \
    PORT=3000

# The worker and scheduler currently execute TypeScript through package scripts,
# so the deterministic dependency tree is retained in the runtime image. Once
# those jobs are compiled, this stage can safely switch to production-only deps.
COPY --from=builder --chown=node:node /app /app
COPY --chown=root:root scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

RUN chmod 0555 /usr/local/bin/docker-entrypoint.sh \
    && mkdir -p /app/.next/cache \
    && chown -R node:node /app/.next

USER node
EXPOSE 3000

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["web"]
