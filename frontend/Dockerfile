# The frontend in production: built with Node, served by Caddy (see
# Caddyfile). Node is only used to build; the image holds the built files.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && node scripts/precompress.mjs dist

FROM caddy:2-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
