# ==========================================
# Base
# ==========================================
FROM node:22-alpine AS base

WORKDIR /app

RUN corepack enable


# ==========================================
# Dependencies
# ==========================================
FROM base AS deps

WORKDIR /app

# Required because package.json runs:
# "prepare": "lefthook install"
RUN apk add --no-cache git

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY lefthook.yml ./

COPY frontend/package.json ./frontend/package.json

# Lefthook expects a git repository
RUN git init

RUN pnpm install --frozen-lockfile


# ==========================================
# Build frontend
# ==========================================
FROM base AS builder

WORKDIR /app

# Bring installed pnpm dependencies into builder
COPY --from=deps /app ./

# Copy application source.
# node_modules is excluded by .dockerignore.
COPY . .

ENV NEXT_TELEMETRY_DISABLED=1

RUN pnpm --dir frontend build


# ==========================================
# Production
# ==========================================
FROM node:22-alpine AS runner

WORKDIR /app

RUN corepack enable

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app ./

EXPOSE 8080

CMD ["pnpm", "--dir", "frontend", "start"]
