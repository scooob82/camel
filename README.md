# CamelApache — Integration Studio for Apache Camel

Visual route builder for Apache Camel. One canonical route model, kept in sync with
YAML DSL, XML DSL and generated Java DSL; live validation; export to a runnable
Spring Boot project; Knowledge Base with recipes.

> Independent developer tool. Not affiliated with the Apache Software Foundation.
> “Apache” and “Apache Camel” are ASF trademarks — check the ASF branding policy before
> going public with a name/domain that contains them (`src/config/brand.ts`).

## Run

```bash
npm install
npm run dev        # frontend only, http://localhost:5173 (projects stay in the browser)

npm run build      # → dist/ (app + static KB pages + PHP API)
npm run migrate    # SQLite dev database
npm run serve      # app + API on http://127.0.0.1:8080

npm test           # core unit tests + catalog generator
npm run test:api   # PHP API end-to-end tests (built-in server + SQLite)
npm run test:e2e   # browser tests (Playwright) against dist/ + API
npm run catalog    # regenerate the component catalog from camel-catalog
```

Requires Node 20+ and PHP 8.2+ (pdo_sqlite for local dev, pdo_mysql in production).

## Deploy

See [docs/DEPLOY.md](docs/DEPLOY.md). In short: `npm run build`, upload `dist/` over SFTP,
put `cas-config.php` above the web root, run migrations. GitHub Actions does build + tests (CI)
and SFTP upload + migrations (Deploy).

## What is in the app

| Area | Status |
|---|---|
| Visual builder: drag & drop, quick insert, move, multi-select, copy/paste, undo/redo, zoom, pan, collapse, keyboard navigation | ✅ |
| 35 EIPs incl. saga, onCompletion, choice, split, aggregate, circuitBreaker, throttle, enrich, recipientList, doTry… | ✅ |
| onException with redelivery + exponential back-off and a timeline preview | ✅ |
| REST DSL (visual editor) | ✅ |
| Contract-first: OpenAPI / AsyncAPI / WSDL → routes | ✅ |
| YAML & XML DSL two-way sync, Java DSL export | ✅ |
| Component catalog: curated + generator from the official camel-catalog | ✅ |
| Validation & lint, JSONPath / XPath tester | ✅ |
| Snippets library, version history with diff | ✅ |
| Export: route files, Spring Boot project (YAML/XML/Java), Mermaid docs | ✅ |
| Accounts (register, verify e-mail, reset password, GDPR export, delete), cloud sync, conflict detection, read-only share links | ✅ |
| Knowledge Base: 20 recipes, static SEO pages + sitemap | ✅ |
| Beans and routeConfiguration editors, canvas minimap, snippets synced to the account | ✅ |
| Run & Debug: sandbox runs (Java `runner/`), message trace on the canvas, replay with breakpoints, mocks, chaos faults, branch coverage, JUnit generation | ✅ (runner needs a VPS with Docker) |
| Transformation Lab (`#/lab`): XSLT 1.0/3.0 + XQuery (Saxon), debugger & profiler, mapper ⇄ XSLT ⇄ CSV, JSON ⇄ XML, XSD diff + impact, test data | ✅ |
| Admin (`#/admin`), privacy-friendly analytics, client error reporting, optional Sentry/Plausible | ✅ |
| Czech / English UI | ✅ |
| Java DSL import, Simple evaluation in the inspector | ⏳ |

## Sandbox runner

`runner/` is a separate Spring Boot service (Camel 4.10, Saxon-HE) that executes routes and transformations. The PHP API proxies to it (`runner` section in `cas-config.php`) and enforces plan quotas. See [runner/README.md](runner/README.md).

## Roadmap

Stav projektu a co zbývá: [docs/ROADMAP.md](docs/ROADMAP.md)

## Architecture

```
src/
  core/        framework-free domain logic (unit-tested)
    model.ts       canonical route model (source of truth)
    eip.ts         EIP definitions + factories
    catalog.ts     component catalog + URI helpers
    yaml.ts        YAML DSL  ⇄ model
    xml.ts         XML DSL   ⇄ model   (xmlparse.ts: tiny XML parser)
    java.ts        model → Java DSL
    validate.ts    validation & lint rules
    edit.ts        immutable tree operations
    docs.ts        Mermaid + endpoint table
    export.ts      Spring Boot project generator, ZIP
    contract.ts    OpenAPI / AsyncAPI / WSDL scaffolding
    diff.ts        line diff for version comparison
    jsonpath.ts    JSONPath evaluator for the tester
  content/     Knowledge Base recipes (plain Camel YAML), generated catalog
  prerender.tsx  static KB pages for search engines (run by the build)
api/           PHP 8.2 API without dependencies (see api/src, api/migrations, api/tests)
tests/e2e/     Playwright scenarios
  app/         router (hash), stores, API client, session, sync, snippets, commands
  features/    landing, dashboard, builder, kb, legal
  ui/          shared UI: code editor, modal, palette, chrome
  styles/      design tokens + styles (dark/light)
```

Key decisions:

- **Canonical model** (`core/model.ts`) mirrors the Camel YAML DSL. The canvas and all
  editors are views of it; text edits only update the model when they parse.
- **Two storage modes** (`app/store.ts`): anonymous users keep projects in `localStorage`;
  signed-in users sync through `/api/v1` with a serial write queue, debounced updates and
  optimistic concurrency (revision → 409 on conflicts). Browser projects can be imported
  into the account.
- **API without a framework**: the hosting only offers PHP, so the API is plain PHP 8.2 with
  PDO (MariaDB in production, SQLite in dev/tests), native sessions, CSRF tokens, DB-backed
  rate limiting and an SMTP mailer. Nothing to `composer install` on the server.
- **Zero heavy dependencies**: React, `yaml`, `jszip`, built with esbuild. The canvas,
  code editor, router and store are small in-house implementations. React Flow / Monaco can
  replace them later behind the same props if needed.
- **Catalog** is curated by hand for now; the data shape mirrors `camel-catalog` so it can
  be generated from the official catalog JSON in a later step.
- Generated projects target Camel `4.10.0` and Spring Boot `3.4.4`
  (`VERSIONS` in `core/export.ts`) — bump when moving to a newer Camel LTS.
