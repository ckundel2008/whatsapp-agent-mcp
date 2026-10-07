FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 connector && useradd --system --uid 10001 --gid connector --home-dir /app connector \
  && mkdir -p /data && chown connector:connector /data
COPY --from=build --chown=connector:connector /app/package.json /app/package-lock.json ./
COPY --from=build --chown=connector:connector /app/node_modules ./node_modules
COPY --from=build --chown=connector:connector /app/dist ./dist
COPY --from=build --chown=connector:connector /app/scripts ./scripts
USER connector
EXPOSE 8787
CMD ["node", "dist/src/index.js"]
