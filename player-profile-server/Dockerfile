FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY frontend/package*.json ./frontend/
RUN npm ci --prefix frontend
COPY frontend/ ./frontend/
RUN npm run build --prefix frontend

FROM node:20-alpine

RUN apk add --no-cache clamav ffmpeg

WORKDIR /app

COPY package.json package-lock.json ./
COPY lib/ ./lib/

# sentiment-core is a file: dependency that ships only sources — build its dist
# before the production install so require('@ludiars/sentiment-core') resolves.
RUN cd lib/lapilli/packages/sentiment-core \
    && npm install --include=dev --package-lock=false \
    && npm run build \
    && rm -rf node_modules \
    && cd /app \
    && npm ci --omit=dev

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]
