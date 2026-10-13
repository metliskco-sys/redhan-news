# Redhan — Maldives News

A full-stack news site for the Maldives, published in English.

- **Frontend:** hand-written HTML, CSS and JavaScript — no framework, no build step
- **Backend:** Node.js + Express
- **Storage:** a JSON file (`db.json`), read and written atomically
- **Auth:** JWT with bcrypt password hashing and role-based access control

## Running it

```bash
npm install
cp .env.example .env
# then edit .env and set JWT_SECRET (see below)
npm start
```

Open <http://localhost:3000>.

| Page | URL |
|---|---|
| Front page | `/` |
| Gallery | `/gallery` |
| Article | `/article?slug=<article-slug>` |
| About / Contact / Advertise / Careers | `/about` `/contact` `/advertise` `/careers` |
| Privacy / Terms / Cookies | `/privacy` `/terms` `/cookies` |
| Staff desk | `/desk` (redirects to `/login` unless signed in as admin) |
| Sign in | `/login` |

### `JWT_SECRET`

This signs login tokens. **The server will not start in production without it.**

```bash
openssl rand -hex 32     # paste the result into .env as JWT_SECRET=...
```

## Staff accounts

The database is seeded on first run with:

| Email | Role | Password |
|---|---|---|
| `super@redhan.mv` | Super admin | `admin123` |
| `admin@redhan.mv` | Admin | `admin123` |
| `writer@redhan.mv` | Writer | `admin123` |

**Change these passwords before this goes anywhere near the public internet** — they are the same on every install.

## What's in the desk

- **Dashboard** — article, user and comment counts, plus site performance: page views, story impressions, teaser clicks and CTR over the last 14 days
- **Articles** — create, edit and delete, with a rich body, cover-image uploader (pan/zoom crop to the right aspect ratio), hashtags, and link embedding for X/Twitter, Facebook, Instagram, YouTube, Vimeo and TikTok
- **Sections** — the article categories
- **Comments** — moderation queue (approve, spam, delete)
- **Users** — create, change role, delete (super admin only)
- **Ad slots** — five fixed advertising placements (header, reading rail, in-feed, in-article, footer). Each takes an uploaded image and a destination link; impressions and clicks are tracked per placement with a CTR chart
- **Settings** — publication name, standfirst, contact email

## Project layout

```
server.js              Express entry point, routing, security headers
config/                database, security controls, .env loader
middleware/auth.js     JWT issue/verify, bcrypt, role guards
routes/                auth, articles, categories, comments, ads, stats, pages, embed, upload
public/                the site: HTML pages, CSS, JS, images
```

## Security notes

- Passwords are stored as bcrypt hashes (cost 12) and never returned by any endpoint
- `JWT_SECRET` comes from the environment; there is no hardcoded default
- Public sign-ups always get the `reader` role — the client cannot choose its own role
- Login is rate-limited with a lockout after five failed attempts
- Author-written HTML is sanitised on write
- Uploaded files are verified by magic bytes, not by the client's claimed type
- CSP, `X-Frame-Options`, HSTS and the other security headers are set on every response
- Comment emails are never exposed publicly, and unmoderated comments are not shown

See `project-plan.md` for the full design and a list of the accepted residual risks.

## Not yet built

- Password reset and email verification
- A real database (the JSON file is fine for a demo, not for concurrent production traffic)
- Automated tests (the checks here have been manual)
