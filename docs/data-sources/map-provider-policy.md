# Map provider policy

Edmonton Infill Tracker renders geographic data with MapLibre GL JS. By default it uses OpenStreetMap's standard raster tiles:

```text
https://tile.openstreetmap.org/{z}/{x}/{y}.png
```

This default needs no API key or account. The map must keep the visible `© OpenStreetMap contributors` attribution and follow the [OpenStreetMap tile usage policy](https://operations.osmfoundation.org/policies/tiles/). The application requests tiles for ordinary interactive viewing only; it must not prefetch, bulk-download, scrape, or offer offline tile packs from this service.

## Privacy boundary

The basemap is internet-backed even when the application itself runs privately on the Mac mini behind Tailscale. Each viewer's browser contacts the configured tile or style provider directly.

The provider can see ordinary web request metadata, such as the viewer's public IP address, browser user agent, and referrer. Tile coordinates also reveal the map area and zoom level being viewed. The application does not append permit records, project markers, street addresses, user identities, session cookies, or application credentials to tile requests.

## Configuration

- `MAP_TILE_URL` selects the raster tile URL template. The checked-in default is the OpenStreetMap URL above.
- `MAP_STYLE_URL` optionally selects a complete HTTPS MapLibre-compatible style. When set, it takes precedence over `MAP_TILE_URL`.

Both values are delivered to browser code and are visible to anyone who can use the application. They are not secret-storage fields. Never place a private API key, bearer token, signed credential, internal hostname, or other secret in either value.

Before changing providers, document and review:

1. authorization and terms for the intended traffic;
2. required attribution and data licensing;
3. browser-visible credentials, URL restrictions, and key rotation, if any;
4. request logging, retention, and privacy implications;
5. caching, rate limits, availability, and a safe failure state;
6. whether the provider permits a local, tailnet-only application.

If ordinary interactive use grows beyond the standard OpenStreetMap service's capacity or policy, move to an approved hosted or self-hosted tile provider before increasing traffic.
