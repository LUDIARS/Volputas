FROM node:20-alpine

RUN apk add --no-cache clamav ffmpeg

WORKDIR /app

COPY package.json package-lock.json ./
COPY lib/lapilli/packages/sentiment-core/package.json ./lib/lapilli/packages/sentiment-core/package.json
COPY lib/lapilli/packages/sentiment-core/src/ ./lib/lapilli/packages/sentiment-core/src/
COPY lib/lapilli/packages/sentiment-core/data/ ./lib/lapilli/packages/sentiment-core/data/
COPY lib/lapilli/packages/sentiment-core/tsconfig.json ./lib/lapilli/packages/sentiment-core/tsconfig.json

RUN cd lib/lapilli/packages/sentiment-core \
    && npm install --include=dev --package-lock=false \
    && npm run build \
    && rm -rf node_modules \
    && cd /app \
    && npm ci --omit=dev

COPY src/ ./src/
COPY scripts/ ./scripts/
COPY migrations/ ./migrations/

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]
