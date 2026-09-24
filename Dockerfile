FROM node:24-alpine AS frontend
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY public ./public
COPY vite.config.mjs ./
RUN npm run build:web

FROM node:24-alpine

ARG VERSION=dev
ARG REVISION=unknown
LABEL org.opencontainers.image.title="Switchboard AI Router" \
      org.opencontainers.image.description="Production-ready multi-provider AI routing gateway" \
      org.opencontainers.image.source="https://github.com/chensl139-ok/switchboard-ai-router" \
      org.opencontainers.image.version=$VERSION \
      org.opencontainers.image.revision=$REVISION

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
COPY --from=frontend /app/public/build ./public/build

ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/readyz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "platform.mjs"]
