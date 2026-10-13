# Redhan News — Project Plan

## Overview
Full-stack news website for the Maldives, in English, with a public frontend and a
role-based CMS backend. **HTML + CSS + vanilla JavaScript frontend, Node.js/Express
backend, JSON-file storage.** No frameworks, no build step.

## Architecture
```
server.js              Express entry point, routes, 404 + error handlers
config/database.js     JSON-file DB (db.json) with seed data and all queries
middleware/auth.js     bcrypt hashing, JWT issue/verify, role guards
routes/                auth, articles, categories, comments, ads, settings
public/                Served statically by Express
  index.html           Homepage: breaking news, category filters, article grid, ad slot
  login.html           Login page
  register.html        Public signup page
  article.html         Article detail page (body, tags, comments)
  404.html             Not-found page
  css/main.css         Dark theme, responsive layout, animations
  js/api.js            Fetch client for /api/*
  js/app.js            Homepage app (nav, filtering, auth, admin panel)
  js/article.js        Article page logic
```

## Roles
| Role       | Can do                                                        |
|------------|---------------------------------------------------------------|
| reader     | Read, comment (public signups are always `reader`)            |
| writer     | Create/edit/delete own articles, dashboard                      |
| admin      | All articles, categories, comments, ads, view users, dashboard |
| superadmin | Everything + create/edit/delete users, site settings            |

Default seeded accounts (password `admin123`):
- `super@redhan.mv` — superadmin
- `admin@redhan.mv` — admin
- `writer@redhan.mv` — writer

## Routes
**Frontend:** `/`, `/login`, `/register`, `/article?slug=…`, 404 for anything else.
**API:** `/api/auth` (login, signup, profile, users), `/api/articles` (CRUD + dashboard),
`/api/categories`, `/api/comments`, `/api/ads`, `/api/settings`.
Unknown `/api/*` paths return JSON 404; unknown pages return the 404 page.

## Design System
- **Theme:** dark (`#0a0f1d` bg, `#111827` panels, `#ff6b35` accent)
- **Fonts:** Fraunces (headings) + Inter (body) via Google Fonts
- **Layout:** max-width 1400px, responsive grid (`auto-fill, minmax(320px, 1fr)`)
- **Motion:** fade-in-up cards, shimmer breaking-news bar, hover lift, skeletons
- **Breakpoints:** ≤480px, ≤768px, ≤1024px

## Data Model (db.json)
`users`, `categories`, `articles`, `comments`, `ad_slots`, `site_settings`.
IDs are integers; the DB layer coerces route-param strings via `num()`.

## Commands
```
npm start     # start server on :3000 (auto-creates + seeds db.json)
npm run check # syntax-check all JS files
```

## Security

**Required environment variable in production:**
```
JWT_SECRET=<at least 32 random characters>
```
If unset in production the server refuses to start. In development a random
ephemeral secret is generated per boot (sessions do not survive a restart).

Optional: `ALLOWED_ORIGIN` to pin CORS to a single origin, `PORT` to change the port.

**Controls in place** (`config/security.js`)

| Area | Control |
|---|---|
| Headers | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, HSTS, Referrer-Policy, Permissions-Policy, XSS-Protection |
| Auth | JWT (HS256), 12-round bcrypt, 7-day expiry, Bearer-only, generic "Invalid credentials" errors |
| Brute force | Per-IP+email rate limit (10 / 15 min) plus progressive lockout after 5 failures (15 min) |
| Signup | 5 / hour per IP; role is **hard-coded to `reader`** — the client's `role` field is ignored |
| Privesc | Only a superadmin may change roles; nobody may change their own; the last superadmin cannot be demoted or deleted |
| IDOR | Author checked server-side on article edit/delete; profile updates bind to the token's user id |
| XSS | All author-authored HTML sanitised on write (script/iframe/object/style stripped, `on*` handlers removed, `javascript:`/`data:` URLs neutralised) |
| Upload | Client MIME and filename are ignored — **magic-byte signatures** are verified (PNG/JPEG/GIF/WebP/AVIF), extension is derived from the detected type, 8 MB cap |
| Privacy | Public comment endpoints return `approved` comments only and never expose `author_email`; `password` fields are stripped from every user payload |
| DoS | 256 KB JSON body limit, broad 120 req/min API limit, comment submissions 5 / 10 min, upload directory not executable |
| Info leak | Central error handler returns a generic 500 with no stack traces; `db.json` and source files are outside the web root (404) |
| File store | `db.json` is read/written atomically (temp file + rename) and chmod `0600` |

**Residual risks, accepted by design**
- Article bodies are HTML authored by staff. Sanitising reduces but does not
  eliminate XSS from a compromised writer account; a strict allow-list
  sanitiser would be the next step.
- Rate limiting is in-memory, so it resets on restart and does not span
  multiple processes behind a load balancer.
- No password reset / email verification flow exists yet.


## Known Limitations
- Storage is a single JSON file rewritten on each write (fine for this scale, not for
  concurrent high-write production).
- No password reset / email verification.
- Article body is stored as admin-authored HTML and rendered unescaped (by design).
- File uploads are not implemented; images are URLs only.
