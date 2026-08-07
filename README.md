# NorvexManagement · Multi-Project

A multi-project spreadsheet-style data manager with theming, CSV import/export,
and optional cloud sync via Supabase.

## Files

- `index.html` — page structure/markup
- `style.css` — all styles, including the theme system (light/dark/ocean/forest/sunset/purple)
- `script.js` — app logic (projects, sheet rendering, CSV import/export, Supabase sync)

## Running locally

Just open `index.html` in a browser, or serve the folder with any static file server:

```bash
npx serve .
```

## Supabase

The app connects to a Supabase project using a publishable/anon key embedded in
`script.js` (`SUPABASE_URL` / `SUPABASE_ANON_KEY`). This key is meant to be
client-side, but access should still be locked down with Row Level Security
policies on the Supabase table — don't rely on the key being secret.
