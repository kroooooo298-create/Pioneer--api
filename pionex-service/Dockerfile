FROM node:22-alpine
WORKDIR /app
COPY pionex-service/ ./pionex-service/
COPY protected-assets/engine.mjs protected-assets/journal.mjs ./protected-assets/
USER node
ENV NODE_ENV=production
EXPOSE 10000
CMD ["node", "pionex-service/server.mjs"]
