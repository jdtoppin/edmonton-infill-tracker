# syntax=docker/dockerfile:1.7

# Building on the official multi-architecture PostgreSQL image avoids x86
# emulation on Apple Silicon while still installing Debian's PostGIS packages.
FROM postgres:17.10-bookworm

RUN apt-get update \
    && apt-get install --no-install-recommends -y \
      postgresql-17-postgis-3 \
      postgresql-17-postgis-3-scripts \
    && rm -rf /var/lib/apt/lists/*

COPY 10-enable-postgis.sql /docker-entrypoint-initdb.d/10-enable-postgis.sql

