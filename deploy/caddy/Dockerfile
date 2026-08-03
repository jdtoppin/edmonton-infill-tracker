# syntax=docker/dockerfile:1

ARG CADDY_GO_VERSION=1.26.5

FROM golang:${CADDY_GO_VERSION}-alpine3.24 AS builder

ENV CGO_ENABLED=0 \
    GOSUMDB=sum.golang.org

WORKDIR /src

COPY go.mod go.sum main.go ./

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    go mod download && \
    go mod verify && \
    go build \
      -mod=readonly \
      -tags=nobadger,nomysql,nopgx \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/caddy \
      .

FROM alpine:3.24 AS runtime

RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates && \
    mkdir -p /config/caddy /data/caddy /etc/caddy /srv && \
    chmod 1777 /config/caddy /data/caddy

COPY --from=builder /out/caddy /usr/bin/caddy

ENV XDG_CONFIG_HOME=/config \
    XDG_DATA_HOME=/data

LABEL org.opencontainers.image.title="Edmonton Infill Tracker Caddy" \
      org.opencontainers.image.description="Source-pinned Caddy runtime with audited security dependency updates" \
      org.opencontainers.image.source="https://github.com/jdtoppin/edmonton-infill-tracker"

EXPOSE 80 443 443/udp 2019

WORKDIR /srv

CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
