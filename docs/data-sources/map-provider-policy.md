# Map provider policy

Edmonton Infill Tracker renders geographic data with MapLibre GL JS. By default it uses OpenStreetMap's Shortbread vector tiles:

```text
https://vector.openstreetmap.org/shortbread_v1/{z}/{x}/{y}.mvt
```

The app applies its own restrained, flat style to roads, water, land, and buildings. It intentionally omits OpenStreetMap place and boundary label layers so legacy aggregate labels do not compete with the City's current neighbourhood names. The source needs no API key or account. The map must keep the visible `© OpenStreetMap contributors` attribution and follow the [OpenStreetMap vector tile usage policy](https://operations.osmfoundation.org/policies/vector/). The application requests tiles for ordinary interactive viewing only; it must not prefetch, bulk-download, scrape, or offer offline tile packs from this service.

Neighbourhood labels are loaded from the City of Edmonton's current centroid dataset and validated within strict row-count, field, response-size, and Edmonton-coordinate limits before display. Aggregate `Greater …` names are excluded. Dashboard bubbles, project details, filters, and lists use the same City neighbourhood identifiers and current names.

## Privacy boundary

The basemap and current City neighbourhood label overlay are internet-backed even when the application itself runs privately on the Mac mini behind Tailscale. Each viewer's browser contacts the configured tile/style provider and City open-data endpoint directly.

The provider can see ordinary web request metadata, such as the viewer's public IP address, browser user agent, and referrer. Tile coordinates also reveal the map area and zoom level being viewed. The application does not append permit records, project markers, street addresses, user identities, session cookies, or application credentials to tile requests.

For a stricter local-only map boundary, replace the public provider with reviewed, locally hosted MapLibre assets and an Edmonton-scoped tile package. Do not bulk-download the public OpenStreetMap tile service to create that package.

## Configuration

- `MAP_TILE_URL` selects the tile URL template. The checked-in default and the former standard-raster default both resolve to the locally styled OpenStreetMap vector map above, allowing existing installations to receive the new presentation without editing `.env`. Any other configured URL remains a custom raster provider and retains its intended colours.
- `MAP_STYLE_URL` optionally selects a complete HTTPS MapLibre-compatible style. When set, it takes precedence over `MAP_TILE_URL`.

Both values are delivered to browser code and are visible to anyone who can use the application. They are not secret-storage fields. Never place a private API key, bearer token, signed credential, internal hostname, or other secret in either value.

Before changing providers, document and review:

1. authorization and terms for the intended traffic;
2. required attribution and data licensing;
3. browser-visible credentials, URL restrictions, and key rotation, if any;
4. request logging, retention, and privacy implications;
5. caching, rate limits, availability, and a safe failure state;
6. whether the provider permits a local, tailnet-only application.

If ordinary interactive use grows beyond the standard OpenStreetMap service's capacity or policy, move to an approved hosted or self-hosted provider before increasing traffic.
