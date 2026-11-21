# CamelApache — Integration Studio for Apache Camel (MVP)

Visual route builder for Apache Camel. One canonical route model, kept in sync with
YAML DSL, XML DSL and generated Java DSL; live validation; export to a runnable
Spring Boot project; Knowledge Base with recipes.

> Independent developer tool. Not affiliated with the Apache Software Foundation.
> “Apache” and “Apache Camel” are ASF trademarks — check the ASF branding policy before
> going public with a name/domain that contains them (`src/config/brand.ts`).

## Run

```bash
npm install
npm run dev        # http://localhost:5173 (watch + rebuild)
npm run build      # → dist/ (static files)
npm test           # core unit tests (parsers, serializers, validation, export)
npm run typecheck  # tsc --noEmit
```

Requires Node 20+.

## Deploy (VMS Smart / any Apache)

1. `npm run build`
2. Upload the **content** of `dist/` (including `.htaccess`) via SFTP/rsync to the web root.

Routing uses `#/hash` URLs, so no rewrite rules are needed.

```bash
rsync -avz --delete dist/ user@host:/path/to/www/
```

## What is in the MVP

| Area | Status |
|---|---|
| Visual builder: drag & drop, click-to-insert, move, duplicate, undo/redo, zoom, resizable panels | ✅ |
| 25 EIPs incl. choice, filter, split, aggregate, multicast, loop, idempotentConsumer, doTry/doCatch/doFinally | ✅ |
| `onException` error handlers with redelivery | ✅ |
| Component catalog (40 components) with option forms | ✅ curated subset |
| YAML DSL import/export, editable, two-way sync | ✅ |
| XML DSL import/export, editable, two-way sync | ✅ |
| Java DSL | ✅ export only |
| Unknown YAML steps / top-level elements preserved | ✅ |
| Validation + lint (required fields, URI checks, HTTP timeouts, hard-coded secrets, error handling…) | ✅ |
| JSONPath / XPath expression tester | ✅ (Simple needs a runtime → Run & Debug) |
| Export: route files ZIP, Spring Boot project ZIP (YAML / XML / Java), Mermaid + endpoint docs | ✅ |
| Projects, version history, local persistence | ✅ browser storage |
| Knowledge Base: 12 recipes, EIP & component reference, open in builder | ✅ |
| Command palette (Ctrl/Cmd K), dark/light mode, responsive | ✅ |
| Accounts, cloud sync (Laravel API) | ⏳ next milestone |
| Run & Debug, Transformation Lab, Migration Center, AI | ⏳ roadmap |

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
    jsonpath.ts    JSONPath evaluator for the tester
  content/     Knowledge Base recipes (plain Camel YAML)
  app/         router (hash), stores, persistence boundary, commands
  features/    landing, dashboard, builder, kb, legal
  ui/          shared UI: code editor, modal, palette, chrome
  styles/      design tokens + styles (dark/light)
```

Key decisions:

- **Canonical model** (`core/model.ts`) mirrors the Camel YAML DSL. The canvas and all
  editors are views of it; text edits only update the model when they parse.
- **Persistence boundary**: `ProjectRepository` in `app/store.ts`. The MVP uses
  `localStorage`; the Laravel `/api/v1/projects` backend will implement the same interface.
- **Zero heavy dependencies**: React, `yaml`, `jszip`, built with esbuild. The canvas,
  code editor, router and store are small in-house implementations. React Flow / Monaco can
  replace them later behind the same props if needed.
- **Catalog** is curated by hand for now; the data shape mirrors `camel-catalog` so it can
  be generated from the official catalog JSON in a later step.
- Generated projects target Camel `4.10.0` and Spring Boot `3.4.4`
  (`VERSIONS` in `core/export.ts`) — bump when moving to a newer Camel LTS.
