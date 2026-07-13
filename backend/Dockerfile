# Build stage
FROM golang:1.25.12-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
ARG APP_VERSION=dev
RUN CGO_ENABLED=0 go build -ldflags="-s -w -X main.appVersion=${APP_VERSION}" -o /memba ./cmd/memba

# Litestream stage
FROM litestream/litestream:0.3.13 AS litestream

# Runtime stage
FROM alpine:3.19

# nodejs runs the BARRICADE verify worker (internal/arcade): the Go binary
# go:embed's the esbuild bundle and execs `node` to re-simulate a submitted run.
# node reads the extracted .cjs as a data file (it is the executable itself), so
# no node_modules and no exec perms on /tmp are needed.
RUN apk add --no-cache ca-certificates tzdata nodejs

RUN addgroup -S memba && adduser -S memba -G memba

WORKDIR /app

COPY --from=builder /memba .
COPY --from=litestream /usr/local/bin/litestream /usr/local/bin/litestream
COPY litestream.yml /etc/litestream.yml
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh

RUN mkdir -p /data && chown memba:memba /data && \
    chown memba:memba /etc/litestream.yml /app/start.sh

USER memba

ENV PORT=8080
ENV DB_PATH=/data/memba.db

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["/app/start.sh"]
