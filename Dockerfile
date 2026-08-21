FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/cloud-service/package.json packages/cloud-service/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/daemon/package.json packages/daemon/package.json
RUN npm ci \
  --workspace @belay/contracts \
  --workspace @belay/cloud-service \
  --include-workspace-root=true
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/cloud-service packages/cloud-service
RUN npm run build --workspace @belay/contracts && npm run build --workspace @belay/cloud-service

FROM node:22-slim AS production-dependencies
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/cloud-service/package.json packages/cloud-service/package.json
COPY packages/dashboard/package.json packages/dashboard/package.json
COPY packages/daemon/package.json packages/daemon/package.json
RUN npm ci \
  --omit=dev \
  --workspace @belay/contracts \
  --workspace @belay/cloud-service \
  --include-workspace-root=false

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/cloud-service/package.json ./packages/cloud-service/package.json
COPY --from=build /app/packages/cloud-service/dist ./packages/cloud-service/dist
USER node
CMD ["node", "packages/cloud-service/dist/index.js"]
