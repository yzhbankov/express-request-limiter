# Security policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | yes |
| 0.x | no, please upgrade |

## Reporting a vulnerability

Please do not open a public issue for security problems. Use GitHub's private
vulnerability reporting on the repository, or email the maintainer listed in
`package.json`. You will receive an acknowledgement within a few days and a
fix or mitigation plan as soon as the report is confirmed.

## Design notes relevant to security

- The package has no runtime dependencies.
- Route patterns are compiled with escaped literals; only `:param` and `*` have special meaning, and the generated expressions are anchored and linear.
- Keys produced by `keyGenerator` are used as `Map` keys only and never interpolated into anything.
- Limits fail closed by default when a store errors (`passOnStoreError: false`).
