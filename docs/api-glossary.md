# Sinkronis API glossary

These terms are canonical for new backend and OpenAPI contracts. Existing public aliases remain supported until a versioned removal is announced.

| Canonical term | Meaning | Compatibility note |
| --- | --- | --- |
| Organization | A tenant/workspace and its isolation boundary | Existing `/organization` routes remain canonical; prose may use British “organisation” only in user-facing copy. |
| Employee | A person managed through HRIS and projected into Employee Portal and Payroll | Do not introduce `staffId`; use `employeeId`. Existing Tenant Admin `/staff` is a compatibility route. |
| Client | An Accounting customer that receives invoices | Do not introduce a parallel `customer` resource. |
| Agent | An external or delegated Accounting collaborator | Not interchangeable with Client or Employee. |
| Payee | A configured Payroll recipient outside employee payroll | Not interchangeable with vendor unless a future versioned vendor domain is introduced. |
| Tenant ID | The authenticated organization boundary | Public request bodies must not accept `tenantId`; services use `organizationId` from authentication context. |
| Date-only | Calendar value formatted `YYYY-MM-DD` | Validate as a real calendar date and store/interpret using the owning workflow’s timezone rules. |
| Timestamp | UTC instant formatted as ISO 8601 | API serialization must include a UTC offset (`Z` where applicable). |
| Money | Decimal domain amount in the stated currency | Never use currency symbols in stored values and never mutate wallet balances outside ledger-backed workflows. |
| In-App | Notification delivery channel key `IN_APP` | `INAPP` is not a supported alias. |
| Cancelled | Canonical user-facing spelling | Existing persisted enum spellings remain unchanged unless migrated and versioned. |
