# Mochi — container image.
#
# The app runs TypeScript directly through tsx (no build step; tsconfig is noEmit), so tsx has
# to exist at runtime even though it is a devDependency. That is why the install below keeps dev
# dependencies — do not put NODE_ENV=production on that step or the container starts and then
# fails to resolve tsx.
FROM node:22-alpine

# tini forwards SIGTERM and reaps zombies, so the app's shutdown handler runs on pod stop.
RUN apk add --no-cache tini

WORKDIR /app

# Dependencies first, so this layer is cached across source changes.
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force

COPY tsconfig.json ./
COPY src ./src
COPY public ./public
COPY docs ./docs

ENV DATA_DIR=/app/data \
    PORT=3000 \
    NODE_ENV=production

# SQLite, bots.json and secrets.json live here: mount a volume at /app/data.
RUN mkdir -p /app/data && chown -R node:node /app && chmod 700 /app/data
USER node

EXPOSE 3000
VOLUME ["/app/data"]

# /health answers without auth, so this works behind any ingress or load balancer.
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "--disable-warning=ExperimentalWarning", "--import", "tsx", "src/index.ts"]
