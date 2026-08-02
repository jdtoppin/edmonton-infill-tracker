-- PostGIS must exist before migrations create geometry-backed columns.
CREATE EXTENSION IF NOT EXISTS postgis;
