# syntax=docker/dockerfile:1

ARG CADDY_GO_VERSION=1.26.5
ARG CADDY_VERSION=2.11.4
ARG CADDY_X_TEXT_VERSION=0.40.0
ARG CADDY_GRPC_VERSION=1.83.0

FROM golang:${CADDY_GO_VERSION}-alpine3.24 AS builder

ARG CADDY_VERSION
ARG CADDY_X_TEXT_VERSION
ARG CADDY_GRPC_VERSION

ENV CGO_ENABLED=0 \
    GOSUMDB=sum.golang.org

WORKDIR /src

COPY go.mod main.go ./

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod edit -require="github.com/caddyserver/caddy/v2@v${CADDY_VERSION}" && \
    go mod edit -require="golang.org/x/text@v${CADDY_X_TEXT_VERSION}" && \
    go mod edit -require="google.golang.org/grpc@v${CADDY_GRPC_VERSION}" && \
    go mod tidy && \
    go build \
      -tags=nobadger,nomysql,nopgx \
      -trimpath \
      -ldflags="-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v${CADDY_VERSION}" \
      -o /out/caddy \
      .

FROM alpine:3.24 AS runtime

ARG CADDY_VERSION

RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates && \
    mkdir -p /config/caddy /data/caddy /etc/caddy /srv && \
    chmod 1777 /config/caddy /data/caddy

COPY --from=builder /out/caddy /usr/bin/caddy

ENV XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data

LABEL org.opencontainers.image.title="Edmonton Infill Tracker Caddy" \
      org.opencontainers.image.description="Source-pinned Caddy runtime with audited security dependency updates" \
      org.opencontainers.image.source="https://github.com/jdtoppin/edmonton-infill-tracker" \
      org.opencontainers.image.version="v${CADDY_VERSION}"

EXPOSE 80 443 443/udp 2019

WORKDIR /srv

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
