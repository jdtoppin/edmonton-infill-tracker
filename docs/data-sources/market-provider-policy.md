# Market-comparison provider policy

Market comparison is disabled until a provider passes this review. Publicly viewable pages are not automatically licensed for background collection.

## Activation checklist

Before adding a market adapter, record:

- the written authorization, API agreement, or terms clause permitting automated access;
- geographic coverage, including explicit Edmonton coverage;
- whether scheduled collection and persistent storage are permitted;
- permitted fields, retention periods, deletion obligations, attribution, and redistribution limits;
- authentication and secret-storage requirements;
- documented rate limits, retry rules, and support contacts;
- whether photos, descriptions, prices, and historical status may be retained;
- a disable switch and data-removal procedure.

The adapter must use an official API or connector. It must not use hidden website endpoints, browser-cookie automation, HTML scraping, or unofficial wrappers.

## Current candidate status

Validated against the providers' public terms on 2026-08-01:

| Candidate                                         | Phase 2 status | Reason                                                                                                                                   |
| ------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [REALTOR.ca](https://www.realtor.ca/terms-of-use) | Disabled       | Website terms prohibit scraping and data extraction. The DDF feed requires separate authorization.                                       |
| [REW](https://www.rew.ca/terms)                   | Disabled       | Terms prohibit automated devices and systematic scraping/querying.                                                                       |
| [Zolo](https://www.zolo.ca/legal-terms)           | Disabled       | Terms prohibit robots, data mining, and similar extraction.                                                                              |
| [Zealty](https://www.zealty.ca/terms)             | Disabled       | Website scraping is prohibited. Its approved MCP exception is non-systematic and currently covers British Columbia rather than Edmonton. |
| Social media                                      | Disabled       | Requires an official platform API/connector or manual evidence supplied by the user.                                                     |

Written authorization or materially revised terms can change this status after a fresh review.

## Occupancy-triggered review

A newly reported occupancy date may prioritize an already-classified new residential infill project for a future market re-check. It does not imply that a listing exists and does not authorize collection from any market provider. Commercial work, renovations, garages, demolition records, and other non-qualifying projects must not become market candidates merely because an occupancy date is present.

## Safe MVP alternative

A later manual-evidence workflow may store only an external URL, observed date, asking price, address, and short user-authored note. It should link to the source rather than copying listing descriptions or photos.
