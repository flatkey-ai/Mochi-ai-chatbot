# Mochi — container image.
#
# Two stages on purpose: dependencies are installed on the *build* platform and copied into the
# target image. Installing under QEMU (the arm64 half of a multi-arch build) makes npm die with
# exit code 132 / SIGILL, and every dependency here is pure JavaScript, so an installed tree is
# portable between architectures. This keeps linux/arm64 working without emulating npm.
#
# The app runs TypeScript through tsx (no build step; tsconfig is noEmit), so tsx must exist at
# runtime even though npm classifies it as a devDependency: never put NODE_ENV=production before
# the install, or npm ci drops tsx and the container starts and then dies.
FROM --platform=$BUILDPLATFORM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev --no-audit --no-fund && npm cache clean --force

FROM node:22-alpine

# tini forwards SIGTERM and reaps zombies, so the app's shutdown handler runs on pod stop.
RUN apk add --no-cache tini

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.json ./
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
