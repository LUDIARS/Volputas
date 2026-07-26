FROM node:20-alpine AS frontend-builder

WORKDIR /app

COPY frontend/package*.json ./frontend/
RUN npm ci --prefix frontend
COPY frontend/ ./frontend/
RUN npm run build --prefix frontend

FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
COPY lib/ ./lib/
RUN npm ci --omit=dev

COPY src/ ./src/
COPY migrations/ ./migrations/
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/app.js"]
