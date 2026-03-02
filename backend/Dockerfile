# Build stage
FROM golang:1.25-alpine AS builder

WORKDIR /app

# Cache dependencies
COPY go.mod go.sum ./
RUN go mod download

# Build
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /memba ./cmd/memba

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

RUN addgroup -S memba && adduser -S memba -G memba

WORKDIR /app

COPY --from=builder /memba .

RUN mkdir -p /data && chown memba:memba /data

USER memba

ENV PORT=8080
ENV DB_PATH=/data/memba.db

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD wget -qO- http://localhost:8080/health || exit 1

CMD ["./memba"]
