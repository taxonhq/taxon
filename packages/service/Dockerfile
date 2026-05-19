# ── Stage 1: install deps ─────────────────────────────────────────
FROM node:20-alpine AS deps
RUN npm install -g pnpm@latest
WORKDIR /app
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# ── Stage 2: build ────────────────────────────────────────────────
FROM deps AS builder
COPY . .
RUN pnpm prisma generate && pnpm build

# ── Stage 3: runtime (minimal image, non-root) ────────────────────
FROM node:20-alpine AS runner
WORKDIR /app

RUN addgroup -S taxon && adduser -S taxon -G taxon

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/prisma ./prisma

RUN chown -R taxon:taxon /app
USER taxon

EXPOSE 3300

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3300/health || exit 1

CMD ["node", "dist/index.js"]
