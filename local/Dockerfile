FROM node:22-alpine AS deps
WORKDIR /package
RUN apk add --no-cache openssl

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/server-core/package.json packages/server-core/package.json
COPY packages/ui/package.json packages/ui/package.json
COPY packages/config/package.json packages/config/package.json
COPY local/package.json local/package.json


RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    set -eu; \
    attempt=1; \
    max_attempts=3; \
    until npm ci; do \
      if [ "$attempt" -ge "$max_attempts" ]; then \
        echo "npm ci failed after ${max_attempts} attempts" >&2; \
        exit 1; \
      fi; \
      delay=$((attempt * 10)); \
      echo "npm ci attempt ${attempt} failed; retrying in ${delay}s" >&2; \
      sleep "$delay"; \
      attempt=$((attempt + 1)); \
    done

FROM node:22-alpine AS builder
WORKDIR /package
RUN apk add --no-cache openssl

ARG APP_RELEASE_VERSION=
ARG APP_BUILD_SHA=
ARG APP_VERSION=
ARG APP_VERSION_TOKEN=
ARG BASE_PATH=
ENV APP_RELEASE_VERSION=${APP_RELEASE_VERSION}
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV APP_VERSION_TOKEN=${APP_VERSION_TOKEN}
ENV BASE_PATH=${BASE_PATH}

COPY --from=deps /package/node_modules node_modules
COPY packages/core packages/core
COPY packages/server-core packages/server-core
COPY packages/ui packages/ui
COPY packages/config packages/config
COPY local local

WORKDIR /package/local
RUN npm run build

FROM deps AS production-deps
RUN npm prune --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ARG APP_RELEASE_VERSION=
ARG APP_BUILD_SHA=
ARG APP_VERSION=
ARG APP_VERSION_TOKEN=
ARG BASE_PATH=
ENV APP_RELEASE_VERSION=${APP_RELEASE_VERSION}
ENV APP_BUILD_SHA=${APP_BUILD_SHA}
ENV APP_VERSION=${APP_VERSION}
ENV APP_VERSION_TOKEN=${APP_VERSION_TOKEN}
ENV BASE_PATH=${BASE_PATH}
RUN apk add --no-cache openssl openvpn iproute2 python3

COPY --chown=node:node --from=builder /package/local/.next/standalone ./
COPY --chown=node:node --from=production-deps /package/node_modules ./node_modules
COPY --chown=node:node --from=builder /package/local/.next/static local/.next/static
COPY --chown=node:node --from=builder /package/local/public local/public
COPY --chown=node:node --from=builder /package/local/prisma.config.ts local/prisma.config.ts
COPY --chown=node:node --from=builder /package/local/prisma local/prisma

WORKDIR /app/local
EXPOSE 3000
CMD ["sh", "-c", "../node_modules/.bin/prisma migrate deploy --schema prisma/schema.prisma && node server.js"]
