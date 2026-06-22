# OKO API — Node 22 (SQLite local / PostgreSQL production)
FROM node:22-bookworm-slim

WORKDIR /app

COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY portal/public/ ./portal/public/
COPY data/schema.sql ./data/schema.sql
COPY data/schema.postgresql.sql ./data/schema.postgresql.sql

ENV PORT=3001
ENV OKO_DB_PATH=/app/data/oko.db

RUN mkdir -p /app/data

WORKDIR /app/server
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
