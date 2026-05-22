# Build stage
FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Playwright base image matches installed playwright version (browsers + system deps)
FROM mcr.microsoft.com/playwright:v1.50.0-noble
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/dist ./dist
ENV PORT=8080
EXPOSE 8080
CMD ["node", "dist/index.js"]
