FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src/server ./src/server
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
CMD ["node", "src/server/server.ts"]
