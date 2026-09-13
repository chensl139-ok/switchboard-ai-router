FROM node:22-alpine
RUN apk add --no-cache su-exec
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.mjs platform.mjs accounts.mjs pricing.mjs usage-store.mjs network.mjs realtime.mjs key-store.mjs routing.mjs thinking.mjs docker-entrypoint.sh ./
COPY public ./public
RUN mkdir -p /app/data && chown node:node /app/data && chmod +x /app/docker-entrypoint.sh
ENV HOST=0.0.0.0 PORT=3000 NODE_ENV=production DATA_DIR=/app/data
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["node", "platform.mjs"]
