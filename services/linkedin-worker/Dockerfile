FROM node:22-bookworm-slim

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package*.json ./
RUN npm ci --no-audit --no-fund \
    && npx puppeteer browsers install chrome --install-deps \
    && rm -rf /var/lib/apt/lists/*

COPY src ./src
EXPOSE 8010
CMD ["node", "src/server.mjs"]
