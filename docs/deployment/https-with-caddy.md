# HTTPS with Caddy

The tracked `deploy/Caddyfile.example` is the configuration mounted by Compose. Its default `SITE_ADDRESS=:80` is intended for private-LAN HTTP. Configuration changes are normally made with environment variables so Git updates do not conflict with a locally edited proxy file. The application trusts the forwarded scheme because Caddy overwrites `X-Forwarded-Proto`; it does not trust `X-Forwarded-Host`.

## Public domain

Before exposing the tracker publicly:

1. Patch the Mac mini, Docker Desktop, and application dependencies.
2. Give the Mac mini a stable LAN address.
3. Point the domain's A/AAAA record at the public address.
4. Forward only TCP 80, TCP 443, and UDP 443 from the router to the Mac mini. Never forward 3000 or 5432.
5. Set `SITE_ADDRESS=tracker.example.com` and `UPSTREAM_FORWARDED_PROTO=https` in `.env`.
6. Set the application's canonical URL to `https://tracker.example.com`, enable secure cookies, and confirm trusted-host and CSRF settings match that origin.
7. Recreate Caddy and web so the new environment is loaded:

```sh
docker compose up -d --force-recreate caddy web
docker compose logs --follow caddy
```

Caddy obtains and renews certificates automatically when DNS and inbound ports are correct. Confirm certificate issuance, login, authorization on admin routes, security headers, and the health page from outside the LAN.

If inbound public access is unnecessary, prefer a trusted private VPN and keep `SITE_ADDRESS=:80`. Do not rely on an untrusted Wi-Fi network or obscure port numbers as access control.

## Proxy changes

Validate a modified configuration inside the running image before applying it:

```sh
docker compose run --rm --no-deps caddy validate --config /etc/caddy/Caddyfile
```

Then recreate the proxy and check logs. Never publish the `web` service's port `3000`, and do not change Caddy to pass through a caller-supplied `X-Forwarded-Proto`; the application's proxy trust relies on that private, sanitizing boundary. The application, not Caddy alone, remains responsible for authentication, role checks, input validation, CSRF protection, and rate limiting.
