# OKO API — Node 22 + built-in SQLite
FROM node:22-bookworm-slim

WORKDIR /app

# Repo layout: server code + static portal data for seeding
COPY server/package.json server/package-lock.json* ./server/
RUN cd server && npm ci --omit=dev

COPY server/ ./server/
COPY portal/public/ ./portal/public/
COPY data/schema.sql ./data/schema.sql

ENV NODE_OPTIONS=--experimental-sqlite
ENV PORT=3001
ENV OKO_DB_PATH=/app/data/oko.db

RUN mkdir -p /app/data

WORKDIR /app/server
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "start"]
