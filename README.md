# Norvex · Data List

A browser-based project/spreadsheet tool with Supabase-backed cloud save,
real per-account sign-in, and public/private project sharing with optional
password protection.

## Files

- `index.html` — **this is the actual live app.** All markup, styles, and
  script are embedded directly in this one file (the CSS/JS run entirely
  inline inside `<style>`/`<script>` tags) — this is what GitHub Pages
  serves.
- `style.css` / `script.js` — kept as readable copies of the CSS/JS that's
  embedded in `index.html`, for reference/diffing only. **Editing these
  files alone has no effect on the live site** — `index.html` does not
  link to them. If you change something, change it in `index.html` (and
  optionally mirror the change here too).

No build step — it's a static site. Open `index.html` in a browser, or
serve the folder with any static file host.

## Accounts & security

The app now requires signing in (email + password, via Supabase Auth)
before you can see or create projects. Every project you save to the
cloud is tagged with your account's id (`owner_id`), and the database
policies below only let an account read or write its **own** rows. This
replaces the earlier version, which had no accounts at all and a database
policy that let anyone with the (public) API key read or write any row —
that's the bug behind "my brother's account can see my files."

### One-time setup you need to do in Supabase

1. **Authentication → Providers → Email**: make sure Email sign-in is
   enabled (it's on by default for new projects). You can turn off "Confirm
   email" while testing so new accounts can sign in immediately.
2. **SQL Editor**: run the migration below once. It adds an `owner_id`
   column to both tables and replaces the old "anyone can write" policy
   with real per-account rules.

```sql
-- Add an owner column to both tables
alter table public.projects add column if not exists owner_id uuid references auth.users(id);
alter table public.lobby_projects add column if not exists owner_id uuid references auth.users(id);

-- Make sure row level security is actually on
alter table public.projects enable row level security;
alter table public.lobby_projects enable row level security;

-- Remove the old, over-permissive policy (it allowed anyone to read/write any row)
drop policy if exists "anyone can write" on public.lobby_projects;
drop policy if exists "read public rows" on public.lobby_projects;

-- lobby_projects: an account can see its own projects, or any project
-- someone has published as public. Only the owner can insert/update/delete.
create policy "select own or public" on public.lobby_projects
  for select using (owner_id = auth.uid() or visibility = 'public');

create policy "insert own" on public.lobby_projects
  for insert with check (owner_id = auth.uid());

create policy "update own" on public.lobby_projects
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "delete own" on public.lobby_projects
  for delete using (owner_id = auth.uid());

-- projects (individual files): only the owner can ever read/write these
create policy "select own project files" on public.projects
  for select using (owner_id = auth.uid());

create policy "insert own project files" on public.projects
  for insert with check (owner_id = auth.uid());

create policy "update own project files" on public.projects
  for update using (owner_id = auth.uid()) with check (owner_id = auth.uid());

create policy "delete own project files" on public.projects
  for delete using (owner_id = auth.uid());
```

> **Note on data saved before this fix:** any rows saved to Supabase
> before you run this migration have no `owner_id`, so after the
> migration they won't be readable by anyone through the app (they're
> not deleted, just orphaned). If you need to recover a specific old
> project, sign in with the account you want to own it, find the
> project's `id` in the Supabase table editor, and run:
> `update public.lobby_projects set owner_id = '<your-user-id>' where id = '<project-id>';`
> (and the same for `public.projects` if it has file rows worth keeping).
> Your `<your-user-id>` is shown under **Authentication → Users** in
> Supabase after you sign up.

The connection details live at the top of the app's `<script>` block in
`index.html` (mirrored in `script.js`):

```js
const SUPABASE_URL = 'https://opfvcedujhxstxvcpwkr.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable__uLZlddeqqU-ZJ1eVgtVPQ_rZ11YgFF';
```

Two tables are used:

**`projects`** — stores individual files (sheets) when you click "Save to Cloud".

**`lobby_projects`** — stores project folders that have been made public, so
they're searchable from any browser.

> Note: a public project's password is still a soft, UI-level gate on top
> of the real database rule above — the app checks it before showing you
> the data, but it isn't a second layer of database-level access control.
> That's an acceptable trade-off for a "share this read-only" feature, as
> long as the underlying private-project policies (above) are in place.

## Deploying with GitHub Pages

1. Push this folder to a GitHub repo.
2. In the repo, go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to `Deploy from a branch`,
   pick your branch (e.g. `main`) and `/ (root)`, then save.
4. GitHub will publish the site at `https://<username>.github.io/<repo>/`.

## Features

- Sign in / create an account before accessing your projects
- Lobby of projects, each holding one or more files (sheets)
- Spreadsheet-style editor: add/edit/delete rows and columns, highlights,
  heading rows, CSV import/export
- Cloud save per file via Supabase, scoped to your account
- Multiple color themes, including a new default "Gridline" paper-and-grid theme
- Publish a project as public (optionally password-protected) so others can
  find it via the **Public Projects** search tab and view it read-only

## Follow-up migration: "View and Edit" public sharing

Publishing a project now lets you choose **View Only** (unchanged — read-only
for everyone else) or **View and Edit** (anyone who opens the shared link can
also add/edit rows and columns, and save those changes back). Run this once
in the SQL Editor, after the migration above:

```sql
-- Track which access level a public project was shared with
alter table public.lobby_projects add column if not exists edit_access text not null default 'view'
  check (edit_access in ('view', 'edit'));

-- Let ANY signed-in account update a project's files, but only when the
-- owner has explicitly published it with edit_access = 'edit'. Nothing here
-- lets someone touch a private project or one shared as "view only".
create policy "edit public editable projects" on public.lobby_projects
  for update
  using (visibility = 'public' and edit_access = 'edit')
  with check (visibility = 'public' and edit_access = 'edit');

-- Guardrail: even on an editable public project, only the owner can rename
-- it, change its password, un-publish it, or flip it back to view-only.
-- Everyone else can only change the files/file_count/updated_at columns.
create or replace function public.protect_lobby_admin_fields()
returns trigger as $$
begin
  if auth.uid() is distinct from old.owner_id then
    if new.owner_id is distinct from old.owner_id
       or new.visibility is distinct from old.visibility
       or new.edit_access is distinct from old.edit_access
       or new.password_hash is distinct from old.password_hash
       or new.has_password is distinct from old.has_password
       or new.name is distinct from old.name then
      raise exception 'Only the project owner can change that setting';
    end if;
  end if;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists lobby_projects_protect_admin_fields on public.lobby_projects;
create trigger lobby_projects_protect_admin_fields
before update on public.lobby_projects
for each row execute function public.protect_lobby_admin_fields();
```
