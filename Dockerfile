# Container image for any Docker host: Railway, Fly.io, a VPS, etc.
#   docker build -t dpl-auction .
#   docker run -p 4000:4000 -v auction-data:/data -e ADMIN_PIN=123456 dpl-auction

FROM node:20-slim AS build
WORKDIR /app
# Toolchain in case better-sqlite3 has to compile from source on this platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY server/package.json server/
COPY client/package.json client/
RUN npm ci
COPY . .
RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/data
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server/package.json ./server/package.json
COPY --from=build /app/server/dist ./server/dist
COPY --from=build /app/client/dist ./client/dist
RUN mkdir -p /data
VOLUME /data
EXPOSE 4000
CMD ["node", "server/dist/index.js"]
