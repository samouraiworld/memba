# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY package.json package-lock.json ./
RUN npm ci

# Build with env vars baked in (overridable at compose level)
COPY . .
ARG VITE_API_URL=""
ARG VITE_GNO_CHAIN_ID="test11"
ARG VITE_GNO_RPC_URL="https://rpc.test11.testnets.gno.land:443"
ARG VITE_GNO_BECH32_PREFIX="g"
RUN npm run build

# Runtime stage — static serve with nginx
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA fallback: redirect all non-file requests to index.html
RUN printf 'server {\n\
    listen 80;\n\
    root /usr/share/nginx/html;\n\
    index index.html;\n\
    location / {\n\
    try_files $uri $uri/ /index.html;\n\
    }\n\
    location ~* \\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {\n\
    expires 1y;\n\
    add_header Cache-Control "public, immutable";\n\
    }\n\
    }\n' > /etc/nginx/conf.d/default.conf

EXPOSE 80
