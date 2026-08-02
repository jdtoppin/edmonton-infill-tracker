# Security policy

## Supported version

Security fixes are applied to the current `main` branch. This MVP does not maintain older release branches.

## Report a vulnerability privately

Do not disclose a suspected vulnerability, credential, private hostname, personal information, or production data in a public issue or pull request. Use GitHub's [private vulnerability reporting](https://github.com/jdtoppin/edmonton-infill-tracker/security/advisories/new) instead.

Include the affected version, the smallest safe reproduction, the potential impact, and any suggested mitigation. Redact live credentials and unnecessary personal information.

If a real credential may have been exposed, revoke or rotate it first. Removing it from the latest file or rewriting Git history does not invalidate a credential that has already been published.

## Repository safeguards

GitHub secret scanning and push protection are enabled. The required CI gate scans complete Git history with a checksum-pinned Gitleaks release and rejects new pull-request commits that expose non-noreply email addresses. Local environment files, credentials, certificates, database files, backups, and private deployment state are excluded from Git and Docker build contexts.
