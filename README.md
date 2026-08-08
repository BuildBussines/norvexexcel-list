# Norvex · Data List

A browser-based project/spreadsheet tool with Supabase-backed cloud save, and
public/private project sharing with optional password protection.

## Files

- `index.html` — page structure
- `style.css` — all styling (themes, layout, components)
- `script.js` — all app logic (lobby, sheet editor, Supabase sync, public sharing)

No build step — it's a static site. Open `index.html` in a browser, or serve
the folder with any static file host.

## Supabase setup

This app uses Supabase for cloud save and for public project sharing. The
connection details live at the top of `script.js`:

```js
const SUPABASE_URL = 'https://opfvcedujhxstxvcpwkr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__uLZlddeqqU-ZJ1eVgtVPQ_rZ11YgFF';
```

Two tables are used:

**`projects`** — stores individual files (sheets) when you click "Save to Cloud".

**`lobby_projects`** — stores project folders that have been made public, so
they're searchable from any browser. Create it with:

```sql
create table public.lobby_projects (
  id text primary key,
  name text not null,
  visibility text not null default 'private',
  password_hash text,
  has_password boolean not null default false,
  file_count int not null default 0,
  files jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.lobby_projects enable row level security;

create policy "read public rows" on public.lobby_projects
for select using (visibility = 'public');

create policy "anyone can write" on public.lobby_projects
for all using (true) with check (true);
```

> Note: there's no real user auth in this app — it uses a single shared
> publishable key. The password on a public project is a soft, UI-level gate,
> not a hard security boundary. Anyone querying the Supabase table directly
> with the same key could still read a "protected" project's data. Real
> access control would need a server-side check (e.g. a Supabase Edge
> Function) in front of the `files` column.

## Deploying with GitHub Pages

1. Push this folder to a GitHub repo.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`,
   pick your branch (e.g. `main`) and `/ (root)`, then save.
4. GitHub will publish the site at `https://<username>.github.io/<repo>/`.

## Features

- Lobby of projects, each holding one or more files (sheets)
- Spreadsheet-style editor: add/edit/delete rows and columns, highlights,
  heading rows, CSV import/export
- Cloud save per file via Supabase
- Multiple color themes
- Publish a project as public (optionally password-protected) so others can
  find it via the **Public Projects** search tab and view it read-only
