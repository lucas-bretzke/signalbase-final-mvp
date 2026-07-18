FROM node:22-alpine AS web
WORKDIR /repo
COPY apps/web/package*.json ./apps/web/
RUN cd apps/web && npm install
COPY apps/web ./apps/web
RUN cd apps/web && npm run build

FROM node:22-alpine AS api
WORKDIR /repo
COPY apps/api/package*.json ./apps/api/
RUN cd apps/api && npm install
COPY apps/api ./apps/api
RUN cd apps/api && npm run build
COPY --from=web /repo/apps/web/dist ./apps/web/dist
WORKDIR /repo/apps/api
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--experimental-sqlite", "dist/server.js"]
