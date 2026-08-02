# Edmonton permit source contract

Validated against the live City of Edmonton metadata on 2026-08-01.

## Automated sources

| Dataset                                                                                                        | Resource ID | Durable source key | Event date    |
| -------------------------------------------------------------------------------------------------------------- | ----------- | ------------------ | ------------- |
| [Development Permits](https://data.edmonton.ca/Urban-Planning-Economy/Development-Permits/2ccn-pwtu)           | `2ccn-pwtu` | `city_file_number` | `permit_date` |
| [General Building Permits](https://data.edmonton.ca/Urban-Planning-Economy/General-Building-Permits/24uj-dj8v) | `24uj-dj8v` | `row_id`           | `issue_date`  |

The building-permit `permit_number` field is intentionally blank and must not be used as an identity. The published API spelling `neighbourhood_numberr` includes the trailing `r`.

## Snapshot semantics

The City currently republishes both datasets as complete snapshots. Socrata system row IDs and system timestamps can change for every row during a refresh, so they are not durable incremental watermarks.

The importer therefore:

1. Reads dataset metadata and validates the required schema.
2. Compares the dataset revision with the last successful import.
3. Skips an unchanged revision.
4. Fetches a changed snapshot in deterministic source-key order.
5. Uses canonical payload hashes to create, update, or skip each durable source record.
6. Accepts the new revision only after the complete snapshot is fully traversed and its schema, revision, and row count remain consistent. Deterministic source-validation quarantines keep the run partial but do not force an unchanged 363,000-row snapshot to be downloaded again. Storage or importer failures fail the snapshot without advancing its checkpoint, so valid records are retried.

Date-range backfills filter on the documented event date. They do not advance the full-snapshot revision.

## Occupancy signal

General Building Permits publishes `occupancy_granted_date` as a date-only field. The importer stores it as `PermitEvent.occupancyGrantedDate` without timezone conversion. A newly reported or corrected occupancy date changes the raw-row checksum, so a later City snapshot updates the existing permit event even when its original issue date is old.

The City describes the date as the point when the applicable requirements for use or habitation were met. Its published coverage is narrower than the building-permit dataset:

- residential permits finalized on or after January 1, 2022;
- non-residential permits completed on or after January 1, 2024, and only where an occupancy record exists;
- older records are intentionally blank, and some work does not require an occupancy permit;
- existing-home improvements, including secondary suites, do not receive an occupancy permit.

**A blank occupancy date means “not reported in this dataset,” not “unsafe,” “unfinished,” or “not occupied.”** The field is a progress and trend signal, not legal confirmation for a property transaction. For new homes, it follows successful completion of mandatory inspections and represents permission to occupy; it does not establish that landscaping, grading, sale readiness, or actual occupation is complete.

The overview may show “Occupancy granted — Jul 30, 2026” or “No occupancy date reported.” It must never label a blank value “Occupied: No,” and the application must not represent itself as independently certifying safety, habitability, or permitted use.

## Trust boundary

- Requests use HTTPS and an allowlisted Edmonton hostname.
- Redirects are rejected so configuration cannot silently move ingestion to another host.
- Timeouts, response-size limits, sequential rate limiting, bounded retries, and `Retry-After` handling prevent a stalled or abusive upstream response from monopolizing the worker.
- Only documented columns are requested and normalized. The selected source fields remain in the raw audit payload; volatile Socrata system fields are kept outside its business checksum so a full City refresh does not make every unchanged permit look updated.
- Deterministic row-validation failures are isolated and recorded; storage or importer failures stop the snapshot so transient faults cannot strand a valid row behind an accepted revision.
- Nonblank malformed occupancy dates are quarantined instead of being silently discarded.
- Application-token headers and raw payloads are never written to request logs.

## Attribution and limitations

Source: City of Edmonton Open Data — Development Permits and General Building Permits. Used under the [City of Edmonton Open Data Terms of Use](https://www.edmonton.ca/public-files/assets/document?path=Web-version2.1-OpenDataAgreement.pdf). This application is not affiliated with or endorsed by the City of Edmonton.

The source is provided without warranties of accuracy, completeness, currency, or continuity. Permit issuance is evidence of approval, not proof that construction has started or that a property will be offered for sale.
