# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
RUN mkdir -p public && pnpm exec prisma generate && pnpm exec next build

FROM base AS web
ENV NODE_ENV=production
RUN addgroup -S rede && adduser -S rede -G rede
COPY --from=build --chown=rede:rede /app/public ./public
COPY --from=build --chown=rede:rede /app/.next/standalone ./
COPY --from=build --chown=rede:rede /app/.next/static ./.next/static
USER rede
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/api/health/live').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.js"]

FROM base AS worker-dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM base AS worker
ENV NODE_ENV=production
RUN addgroup -S rede && adduser -S rede -G rede
COPY --from=worker-dependencies --chown=rede:rede /app/node_modules ./node_modules
COPY --chown=rede:rede package.json tsconfig.json ./
COPY --chown=rede:rede prisma ./prisma
COPY --chown=rede:rede scripts ./scripts
COPY --chown=rede:rede src ./src
USER rede
EXPOSE 3002
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3002/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["pnpm", "worker"]
