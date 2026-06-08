# ── Stage 1: build the Vite frontend ────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

# Only install production deps
COPY package*.json ./
RUN npm ci --omit=dev

# Copy the built frontend and server
COPY --from=builder /app/dist ./dist
COPY server.js ./

EXPOSE 3001

CMD ["node", "server.js"]
