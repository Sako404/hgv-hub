# Contributing to HGV HUB

Official upstream: <https://github.com/Sako404/hgv-hub>

Contributions are welcome. This is a small project with a light process — the
one rule that is not light is the data rule, below.

## Setup

```bash
npm install
npm run dev        # solo/local mode, opens on :5173
```

For the self-hosted backend (Fastify + PostgreSQL), see
`docs/BACKEND_SELF_HOSTING.md`.

## Tests and build

```bash
npm test           # Vitest
npm run build      # production build
```

Both must pass before a pull request is ready. CI runs the same two commands.

## Pull requests

- One logical change per PR; a focused diff gets reviewed faster than a broad one.
- Add or update tests for behaviour you change. The domain logic — pay,
  compliance, migrations — is where tests matter most.
- Migrations are append-only and numbered. Do not edit an existing migration
  that has already shipped; add the next one.
- Explain *why* in the PR description. The what is visible in the diff.
- Keep documentation in `docs/` current when you change the model it describes.

## Data rule — synthetic by construction

**Fixtures, seeds, examples, tests and documentation must use synthetic data.**
Not anonymised real data. Synthetic from the start.

Never submit, in code, tests, fixtures, screenshots or issue reports:

- employer, agency, client or customer names;
- real driver or personal details;
- real pay rates, invoices or financial records;
- real shifts, routes, schedules or availability;
- licence, tachograph card or CPC identifiers;
- credentials, tokens or API keys;
- private hostnames, IP addresses or infrastructure details;
- production database dumps or exports.

Superficial anonymisation is not enough — structure, timings and combinations of
otherwise-innocuous values can still identify a real person or business. If a
test needs a company, invent one. Existing fixtures use obviously fictional
names, and new ones should too.

Use documentation-reserved values for examples: `192.0.2.x` (TEST-NET-1) for
addresses, `example.test` for hostnames.

## Licensing

HGV HUB is licensed under **AGPL-3.0-or-later**. By submitting a contribution
you agree it is licensed under those same terms.

There is no CLA and no DCO sign-off requirement. If the project ever genuinely
needs one, that will be discussed openly first rather than imposed quietly.

## Scope

HGV HUB models the rules its workflows need. It is **not** certified compliance
software, and it does not replace a tachograph, an operator's own record-keeping
duties, or professional advice. Contributions should keep that boundary intact —
by all means improve what is modelled, but do not add claims the software cannot
stand behind.
