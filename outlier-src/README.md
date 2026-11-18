# Outlier Research

Multi-user Instagram and YouTube research desk for `https://pages.mattc.com/outlier/`.

The static files in `outlier/` contain no Reels, YouTube rows, hooks, or thumbnails. After login the browser loads `GET /outlier/api/data`.

## npm

Root `package.json`:

```json
{"private": true, "dependencies": {"@netlify/blobs": "11.1.9"}}
```

Netlify provides the Blobs credentials. No other env vars are required for the functions.

## Seed the first admin

The password is read from the environment, never from argv.

```bash
OUTLIER_SEED_PASSWORD='the password' node tools/hash-password.mjs ada@mattc.com "Ada Admin" admin
```

Store that JSON object in the `outlier-users` blob store, keyed by the lowercase email.

## Data bundle

`outlier-data-bundle.json.gz` is the gzipped JSON document. Upload those bytes as the `bundle` key in the `outlier-data` store:

```bash
netlify blobs:set outlier-data bundle outlier-data-bundle.json.gz
```

The function accepts either raw JSON or gzip (magic bytes `1f 8b`) and responds with `content-encoding: gzip`, an ETag, and `cache-control: private, no-store`.

Regenerate after a weekly drop. `--reels-dir` is the staged folder the Reel desk already accepts (it may contain a `youtube/` directory with `processed/`, `broad/`, `thumbs/`, `thumbs-extra/`, and `broad/thumbs/`).

```bash
node tools/build-outlier-bundle.mjs --reels-dir /path/to/staged-data --out outlier-data-bundle.json.gz
```

Optional: `--window-label "Last 90 Days"`.

### Bundle schema

```json
{
  "built_at": "America/Chicago ISO timestamp",
  "yt": {
    "window_label": "Last 90 Days",
    "mine": [],
    "peers": [],
    "broad": [],
    "big": []
  },
  "ig": {
    "picks": [],
    "history": [{ "label": "", "retired_on": "", "picks": [] }],
    "explore": [],
    "inspire": [],
    "shortlist": []
  }
}
```

Cards use `id`, `title`, `creator` or `channel`, `url`, `poster` (WebP data URL, or an `i.ytimg.com` URL only for packaging items added from a link), `views`, `multiplier`, `subs`, `published`, `hook`, and `ai_twist` when the source file had that column. `mine` is Matt's top 5 by `median_x`. `peers` are 20,000–300,000 subscribers. `big` is above 300,000.

## Blob stores

| Store | Contents |
|---|---|
| `outlier-users` | `{email, name, role, hash, salt, n, r, p, disabled, created_at}` keyed by lowercase email |
| `outlier-sessions` | sha256 of the cookie token, plus `fail:email|ip` rate-limit stamps |
| `outlier-saves` | one record per user, platform (`ig` or `yt`), and item id |
| `outlier-swipe` | packaging notes |
| `outlier-data` | key `bundle` |

## HTTP

Cookie `outlier_session` is HttpOnly, Secure, SameSite=Lax, Path=/outlier, Max-Age one year, renewed when the session has been idle for 12 hours. Ten failed logins per email and IP in 15 minutes returns 429. Passwords are scrypt hashes and are not logged.

| Method | Path | Who |
|---|---|---|
| POST | `/outlier/api/login` | public |
| POST | `/outlier/api/logout` | session |
| GET | `/outlier/api/me` | session |
| POST | `/outlier/api/account/password` | session |
| GET | `/outlier/api/data` | session |
| GET | `/outlier/api/saves` | session |
| PUT | `/outlier/api/saves` | session, own item |
| DELETE | `/outlier/api/saves` | session, own item |
| GET | `/outlier/api/swipe` | session |
| POST | `/outlier/api/swipe` | session |
| PATCH | `/outlier/api/swipe` | owner only |
| DELETE | `/outlier/api/swipe` | owner, or any admin |
| GET | `/outlier/api/admin/users` | admin |
| POST | `/outlier/api/admin/users` | admin |
| PATCH | `/outlier/api/admin/users` | admin |
| DELETE | `/outlier/api/admin/users` | admin, body `{email, confirm:true}` |

The last enabled admin cannot be deleted, disabled, or demoted.
