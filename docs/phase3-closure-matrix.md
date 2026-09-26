# Phase 3 financial hardening closure matrix

This matrix records the final disposition of the original P3 findings against
the certified Phase 3A–3G development chain. It is release evidence, not an
authorization to deploy or to enable provider transfers.

| ID | Original issue | Closure | Evidence |
|---|---|---|---|
| P3-01 | Outbound settlement lacked durable, idempotent provider truth | RESOLVED — Phase 3A | `FinancialSettlement`, immutable internal/provider references, settlement recovery tests |
| P3-02 | Provider webhook replay, ordering and authentication gaps | RESOLVED — Phase 3A | durable webhook inbox, signature validation, replay/dead-letter tests |
| P3-03 | Wallet spendable/reservation races | RESOLVED — Phase 3B | conditional wallet SQL, reservation invariants and concurrency tests |
| P3-04 | Currency and monetary precision disagreement | RESOLVED — Phase 3B | currency assertions, Prisma Decimal arithmetic and precision regressions |
| P3-05 | Provider success/failure/reversal could disagree with business state | RESOLVED — Phase 3A/3B | atomic finalization/reversal and reconciliation tests |
| P3-06 | Ambiguous or stale outbound attempts lacked recovery | RESOLVED — Phase 3A | leases, original-reference reconciliation and response-loss tests |
| P3-07 | Failed/stale webhook processing lacked bounded recovery evidence | RESOLVED — Phase 3A | retry/dead-letter lifecycle and stale-claim recovery |
| P3-08 | Subscription payment initialization/completion could become stranded | RESOLVED — Phase 3C | durable attempts, inbound recovery and entitlement-application tests |
| P3-09 | Wallet funding initialization/completion could become stranded | RESOLVED — Phase 3C | funding attempts, original-reference recovery and exactly-once credit tests |
| P3-10 | No system-wide durable financial inconsistency detection | RESOLVED — Phase 3D | scan runs/findings, dedup/resolution/concurrency certification |
| P3-11 | Required financial audit could occur after economic commit | RESOLVED — atomicity hotfix/backport | transaction-aware audit, RepeatableRead and rollback regressions |
| P3-12 | Recovery/scanner freshness and backlogs were not operationally visible | RESOLVED — Phase 3E | financial operations health, run/backlog/finding endpoints and tests |
| P3-13 | Operators lacked safe, audited recovery controls | RESOLVED — Phase 3E | permissioned bounded triggers that reuse certified recovery primitives |
| P3-14 | Correctness-critical jobs assumed persistent workers on serverless | RESOLVED — Phase 3F | authenticated bounded Cron paths, payroll execution hardening and overlap tests |
| P3-15 | Release could proceed with unapplied migrations or unsafe configuration | RESOLVED — Phase 3F | migration gate, readiness/config checks and tracked release runbook |
| P3-16 | Revoked/non-current sessions could retain authorization; privileged sessions accumulated | RESOLVED — Phase 3G | durable `isCurrent` enforcement, revocation on login/logout, row-locked replacement and auth tests |
| P3-17 | Parent deletion could cascade away financial/audit evidence | RESOLVED — Phase 3G | restrictive financial evidence foreign keys and archive-only tenant deletion workflow |
| P3-18 | Unsafe raw SQL lacked an automated regression boundary; provider balance preflight was low-severity | RESOLVED / ACCEPTED LIMITATION — Phase 3G | unsafe-raw guard plus parameterization tests; provider preflight deliberately omitted because a stale/ambiguous balance snapshot cannot establish terminal truth |

The provider-balance limitation does not compromise money integrity: wallet
reservation, durable initiation identity, provider verification/webhooks and
reconciliation remain authoritative. A balance lookup failure therefore cannot
misclassify an attempted transfer or suppress recovery.
