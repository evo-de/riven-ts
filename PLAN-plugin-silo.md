# Plan: `@repo/plugin-silo`

Working plan for adding [Silo](https://siloserver.org/docs) as a media server plugin.
Branch: `feature/plugin-silo`.

> **For agents picking this up:** read this whole file first, then continue from the first
> unchecked item in [Progress](#progress). Tick items off (and add notes/deviations) in this
> file as you go — it is the single source of truth for the state of this work.

## Progress

Legend: `[x]` done · `[ ]` todo · `[~]` in progress / partially done

- [x] Research existing media server plugins (Jellyfin, Plex), generator, plugin registration, wiki
- [x] Research Silo API (scan API, auth, capabilities, Docker setup)
- [x] Decisions agreed with user (see [Decisions](#decisions))
- [x] 1. Scaffold package via `turbo gen plugin` (name: `silo`)
- [x] 2. Settings schema
- [x] 3. Hand-written zod schemas (problem-document schema dropped, see log)
- [x] 4. Datasource `SiloAPI`
- [x] 5. Plugin definition + `download.success` hook
- [x] 6. GraphQL resolvers
- [~] 7. Tests — written, lint/typecheck clean, **not yet run** (no `redis-server`, see log)
- [ ] 8. Dev docker stack (package compose + `.env.silo.example` + root compose)
- [ ] 9. Docs & wiki updates
- [ ] 10. Verification

### Notes / deviations log

_Add dated entries here when something deviates from the plan below._

- 2026-10-28: Plan created. No code written yet.
- 2026-10-28: Toolchain was missing on the dev machine; installed pnpm 12.15.0 (official script,
  `PNPM_HOME=~/.local/share/pnpm`) and Node 24 via `pnpm env use --global 24`. If `pnpm` is not
  on PATH in a fresh shell, `export PATH=$HOME/.local/share/pnpm/bin:$PATH`.
- 2026-10-28: **Tests are not run for now** (user decision): the plugin test context needs a system
  `redis-server` binary (via `redis-memory-server`), which is not installed and there is no Docker.
  Tests are still written; lint, typecheck and build are run instead. Run
  `pnpm --filter @repo/plugin-silo test` once `redis-server` is available.
- 2026-10-28: Step 1 — the generator registered the package as `catalog:` (plus a
  `pnpm-workspace.yaml` catalog entry) in `apps/riven` and `apps/wiki` `dependencies`. Fixed by
  hand to `workspace:^`, and moved to `devDependencies` in `apps/wiki` to match the other plugins.
  Added `@apollo/datasource-rest` and `@typescript/native` to the plugin's package.json (Jellyfin
  has them; the template doesn't). The generator bug itself is not fixed.
- 2026-10-28: Steps 3/4 — `BaseDataSource` (`packages/util-plugin-sdk/lib/datasource/index.ts`)
  drops error response bodies (`parsedBody: null`, `new Response(null, …)`), so Silo's RFC 9457
  problem documents never reach the plugin. Dropped `problem-document.schema.ts`; `SiloAPI` maps
  the documented status codes (400/401/403/404/409/503) to readable reasons instead. Changing the
  SDK to forward error bodies was considered out of scope.
- 2026-10-28: Step 4 — `BaseDataSource` retries requests (3 attempts, exponential backoff) on
  408/425/429/5xx and network errors, including the "non-retryable" `POST /api/v2/scan`. Accepted:
  Silo coalesces same-scope scans, so a repeated request only causes another scan of the same path.
- 2026-10-28: Step 6 — the scaffolded resolvers already matched Jellyfin's; only the resolver spec
  needed its MSW handler pointed at `GET /api/v2/scan/capabilities`.

## Decisions

Agreed with the user — do not revisit without asking:

1. **Native `/api/v2` API only.** The Jellyfin compatibility layer (port 8096, `Library/Media/Updated`)
   must **not** be used anywhere — not in the plugin, not in the dev stack.
2. **Hand-written zod schemas.** No Kubb / no committed OpenAPI spec (Silo's spec is 6.9 MB / 730
   paths and `buildKubbConfig` cannot filter operations).
3. **Small Silo stack in the plugin's compose file** (silo + postgres + redis).
4. **Wiki docker-compose generator** (`apps/wiki/components/docker-compose-generator.tsx`) is
   **out of scope** for now.

## Background: how media server plugins work in this repo

- Reference implementations: `packages/plugin-jellyfin` (simplest) and `packages/plugin-plex`.
- They hook `riven.media-item.download.success`, collect unique directories
  (`path.join(entry.baseDirectory, path.dirname(entry.path))`) from `event.item.getMediaEntries()`,
  prefix them with a configured library path (default `/mount`) and ask the server to rescan them.
- Each plugin also has a `validator`, a `<name>IsValid` GraphQL query, and a placeholder settings
  field resolver on `Settings`.
- Plugins are discovered from `apps/riven/package.json` dependencies (`@repo/plugin-*`);
  `CorePlugins` (`apps/riven/lib/schemas/core-plugins.schema.ts`) is derived from that list. They
  are enabled via `RIVEN_SETTING__enabledPlugins=["silo", ...]`.
- Plugin settings come from env: `RIVEN_PLUGIN_SETTING__REPO_PLUGIN_SILO__<settingName>`.
- Generator: `turbo/generators/generators/plugin.ts` + `turbo/generators/templates/plugin/**`. It
  also adds the dependency to `@repo/riven` and `@repo/wiki`.
- Tests use `@repo/util-plugin-testing/plugin-test-context` + `createMockPluginSettings` + MSW.

## Background: Silo API facts

Sources: `github.com/Silo-Server/silo-server` → `docs/scan-api.md`, `docs/scan-control-api.md`,
`contracts/api/v2/openapi.json`, `docker-compose.yml`, `.env.example`.

- **Auth:** `Authorization: Bearer sa_<key>`. Scan operations require an **admin** API key
  (created in Silo UI: Admin > Sign-in & Security > API Keys). API-key callers omit `X-Profile-Id`.
- **`POST /api/v2/scan`** (`startLibraryScan`)
  - Body: `{ "path"?: string, "library_id"?: string }` (at least one; `additionalProperties: false`).
  - With only `path`, the server resolves the owning library. Subdirectory → `subtree` scan; video
    file → widened to its directory; library root → full `library` scan.
  - `202` → `{ status: "accepted", mode: "library" | "subtree" | "file", library_id: string }`.
  - **Non-retryable** per Silo docs (don't auto-replay), but same-scope requests are coalesced, so a
    duplicate is harmless.
  - Errors are RFC 9457 problem documents; the trailing segment of `type` is the stable code:
    400 `malformed_request` (path outside library roots, missing path, ambiguous, …),
    401 `authentication_required`/`invalid_token`/…, 403 `permission_denied` (not admin),
    404 `not_found`, 409 `conflict` (library disabled), 422 `validation_failed`,
    503 `dependency_unavailable` (scanner not initialised).
- **`GET /api/v2/scan/capabilities`** (`getScanCapabilities`, auth required)
  - `200` → `{ revision: string, state: "available" | "disabled" | "not_configured" | "unsupported", allowed?: boolean }`.
- **`GET /api/v2/system/info`** — unauthenticated; `{ server_version, api_major, contract_digest, links }`.
  Used for the docker healthcheck.
- Paths sent must be paths **as Silo sees them** (container-side).

## Implementation plan

### 1. Scaffold

Run `turbo gen plugin` with name `silo`. Remove anything Kubb-related if the template adds it
(no `@kubb/*`, `@faker-js/faker`, `codegen:api-schemas`). Ensure `turbo.jsonc` tags are
`["group:silo", "type:plugin"]`. Confirm `apps/riven/package.json` and `apps/wiki/package.json`
got `"@repo/plugin-silo": "workspace:^"` and `pnpm-lock.yaml` is updated.

### 2. Settings — `lib/silo-settings.schema.ts`

| Setting           | Validation                                    | Notes                                                    |
| ----------------- | --------------------------------------------- | -------------------------------------------------------- |
| `siloApiKey`      | `z.string().startsWith("sa_")`                | Admin API key; describe the admin requirement            |
| `siloServerUrl`   | `z.url({ protocol: z.regexes.httpProtocol })` | Native API URL, e.g. `http://localhost:8090/` (not 8096) |
| `siloLibraryPath` | `z.string().min(1)`, default `/mount`         | Prefix of Silo library paths as Silo's container sees it |

### 3. Hand-written schemas — `lib/schemas/`

- `scan-start-response.schema.ts`: `{ status: "accepted", mode: enum, library_id: string }`
- `scan-capabilities-response.schema.ts`: `{ state: enum, allowed?: boolean, revision: string }`
- `problem-document.schema.ts`: loose RFC 9457 `{ type, title?, status?, detail? }` + helper that
  extracts the problem code (trailing segment of `type`).

### 4. Datasource — `lib/datasource/silo.datasource.ts`

`SiloAPI extends BaseDataSource<SiloSettings>`, `baseURL = settings.siloServerUrl`,
`serviceName = "Silo"`.

- `willSendRequest`: set `Authorization: Bearer ${siloApiKey}` and `accept: application/json`.
- `scanPath(subPath)`: `POST api/v2/scan` with `{ path: path.join(siloLibraryPath, subPath) }`,
  parse 202 body; on failure throw `SiloAPIError` built from the problem document
  (e.g. `malformed_request: <detail>`). No internal retries.
- `validate()`: `GET api/v2/scan/capabilities`; `true` iff `state === "available" && allowed !== false`.
  Log the reason for other states; request errors are logged and return `false`.

### 5. Plugin — `lib/index.ts`

- `dataSources: [SiloAPI]`, `resolvers: [SiloResolver, SiloSettingsResolver]`,
  `settingsSchema: SiloSettings`, `validator` → `SiloAPI.validate()`.
- Hook `riven.media-item.download.success` (mirror Plex): unique dirs → throw if no entries →
  `Promise.allSettled(paths.map(scanPath))` → aggregate rejections into one `Error` with `cause` →
  log `Requested Silo scan for N path(s) for <fullTitle>`.

### 6. GraphQL

- `lib/schema/silo.resolver.ts`: `siloIsValid` query.
- `lib/schema/silo-settings.resolver.ts` + `types/silo-settings.type.ts`: placeholder like Jellyfin.

### 7. Tests (Vitest + MSW, `lib/__tests__/silo.test-context.ts`)

- `datasource/__tests__/validate.spec.ts`: 401 → false; `not_configured` → false;
  `allowed: false` → false; `available` → true.
- `datasource/__tests__/scan-path.spec.ts`: body path = prefix + subPath; Bearer header sent;
  400 problem doc → `SiloAPIError` with code; malformed 202 body → parse failure.
- `__tests__/download-success.spec.ts`: multiple episodes in one season → single scan;
  no entries → throws; partial failure → aggregated error listing failed paths.
- `schema/__tests__/silo.resolver.spec.ts`: `siloIsValid` → true.

### 8. Dev stack

`packages/plugin-silo/docker-compose.yaml` (trimmed from Silo's upstream compose):

- `silo`: `ghcr.io/silo-server/silo-server:latest`, `env_file: .env.silo`,
  env `MODE: integrated`, `PORT: "8080"`,
  `DATABASE_URL: postgres://silo:silo@silo-db:5432/silo?sslmode=disable`,
  `REDIS_URL: redis://silo-cache:6379`, `SILO_PLUGIN_CACHE_DIR: /var/lib/silo/plugins`.
  `SECRET_KEY` (required; `openssl rand -base64 48`) comes from `.env.silo`.
  Ports: **only** `8090:8080` (no Jellyfin 8096 / ABS 13378 — also avoids clashing with the
  `jellyfin` service). Volumes: `${HOST_VFS_MOUNT_PATH}:/mount:ro,rslave`,
  `./docker-data/silo/{plugins,artwork,compat,transcode}` (transcode → `/tmp/silo-transcode`).
  `stop_grace_period: 2m`. Healthcheck: `GET http://127.0.0.1:8080/api/v2/system/info`.
- `silo-db`: `pgvector/pgvector:pg18`, user/password/db `silo`, `shm_size: 1gb`,
  `pg_isready -U silo` healthcheck, volume `./docker-data/silo/postgres:/var/lib/postgresql`,
  no host port.
- `silo-cache`: `redis:alpine`, `redis-cli ping` healthcheck, volume `./docker-data/silo/redis:/data`,
  no host port.
- `packages/plugin-silo/.env.silo.example` with `SECRET_KEY=` (`.env*` is gitignored,
  `.env*.example` is allowed).
- Root `docker-compose.yaml`: add `silo`, `silo-db`, `silo-cache` via `extends`, profiles
  `all` + `services`. Check with `docker compose config` whether `depends_on`
  (silo → silo-db/silo-cache healthy) survives `extends`; if not, declare it in the root file.

### 9. Docs & wiki

- `docs/plugins/silo/meta.json` (`"title": "Silo"`, description) + `settings.mdx`
  (generated include); run `codegen:config-docs`. Mention admin key + that Silo library roots must
  live under `siloLibraryPath`.
- Mention Silo next to Plex/Jellyfin in `apps/wiki/content/docs/{index,getting-started,troubleshooting,architecture}.mdx`,
  `apps/wiki/content/docs/plugins/index.mdx`, `apps/wiki/app/layout.tsx`.
  (`getting-started.mdx` has a `plexLibraryPath` / `jellyfinLibraryPath` note — add `siloLibraryPath`.)
- `CONTRIBUTING.md`: add Silo to the services list and the `.env.silo` setup step.

### 10. Verification

- `pnpm --filter @repo/plugin-silo test`, `lint`, `build`.
- Root: `pnpm knip`, `pnpm format:check`.
- `docker compose --profile services config` validates.
- Optional manual smoke test: bring up the stack, create a Silo library at `/mount/movies` and an
  admin key, enable `silo` in Riven, confirm a download triggers a `subtree` scan.
