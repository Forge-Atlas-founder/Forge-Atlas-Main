# Security policy

## Reporting

Send a responsible report to `ironjesus74@gmail.com`. Include the affected route, observed impact, and the smallest safe reproduction. Do not include passwords, API keys, full payment data, unrelated personal information, or data that is not yours.

Do not test destructively, attempt persistence, access another person's data, or disrupt the public service. A report is not permission to expand testing beyond the behavior you already observed.

The canonical machine-readable contact is published at `https://forge-atlas.io/.well-known/security.txt`.

## Supported release

Security fixes target the current release on the default branch. Historical source archives are retained for provenance and are not supported production builds.

## Public boundary

The public API is limited to health checks, deterministic public-page audits, registered Fight Club contenders, and registered Swarm providers. Deployment, DNS, cache purge, account, token, and payment operations are intentionally outside the public interface.
