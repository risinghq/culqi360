# Companies

The company page gathers what a workspace knows about one company: its identity,
its contacts, and the cases, calls, visits and campaign records that touched it.
The code is in
[`apps/web/src/server/companies`](../apps/web/src/server/companies). A company
is a row in `organizations`, keyed by RUC within the workspace.

## Search

`/companies` searches by RUC or legal name.

- Text made only of digits matches a RUC prefix. Other text matches any part of
  the legal name, without case. A trigram index on `legal_name` serves it.
- An empty search lists every company the viewer may open.
- Results are ordered by legal name and capped at 50.

## Access

`company:read` opens the search and the page. Without `company:view:all`, a
viewer reaches a company only through work linked to them:

- a case they hold now,
- a campaign record they hold or held, worked or not,
- a call or visit they logged.

A reassigned case moves the company to its new holder. The rule is one query
predicate in
[`companies-repo.ts`](../apps/web/src/server/companies/infrastructure/companies-repo.ts),
not a stored grant.

Access is decided once, on the company. A viewer who reaches it sees all of its
work, including other users' cases and calls.

A queue stage's role, such as the back office or Entel's validador, works cases
it does not hold, so its baseline carries `company:view:all`. A workspace that
adds such a role must grant it too.

A company out of reach reads as `company_not_found`, the same as one that does
not exist.

## Page

Each section lists the newest 100 rows and appears only when it has rows.

- Cases link to the case page.
- Calls and visits show the outcome and notes.
- Campaign records show when they were worked, or who holds them now.
- Contacts show each person's current role, phone and email.

The case header and the rows of a campaign batch link to the company page for a
user with `company:read`.
