# Genesis Secure Solutions platform site

Next.js 16 on Vercel. Everything is noindexed while the platform is an internal preview.

| Route | What |
|---|---|
| `/` and `/film` | The Business in a Box commercial (live animated film + narration, MP4 fallback) |
| `/welcome/<token>` | A client's private welcome package: welcome film + five-step setup guide |
| `/api/progress/<token>` | GET/POST the client's setup progress (Vercel Blob, private) |
| `/welcome/<token>/social` | Step-by-step social setup: Facebook, Instagram, Meta partner access, Google Business Profile, plus optional channels the client can request |
| `/api/social/<token>` | GET/POST the social guide's progress, pasted profile links and channel requests (separate private Blob file) |

## Add the next client
1. Copy `data/clients/mendez-hollis.json`, change the fields, and generate a new token:
   `node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"`
2. Set `social.plan` to the channels in their plan (ids from `lib/channels.ts`); every other channel shows as optional.
3. Put their film and poster in `public/w/<token>/` (use web encodes, about 12 MB).
4. Register the record in `lib/clients.ts`, commit, deploy.

Tokens and prices live only in server code. Never import `lib/clients.ts` from client code.
Anyone holding a client's link can view the guide and tick steps.

## Edit the pages
Edit `data/templates/welcome.html`, `social.html` or the shared `base.css`; `npm run build` bakes them into `lib/templates.ts`.

## Social channels
`lib/channels.ts` is the channel registry. Add a channel there with its access method; add steps only after checking the platform's own help pages. Optional channels with no steps show as "we walk you through it on a call".
Set `GSS_META_BUSINESS_ID` and `GSS_GOOGLE_INVITE_EMAIL` in Vercel to show them in the guide (see `.env.example`).

## See a client's progress
`node --env-file=.env.local scripts/client-status.mjs mendez-hollis` prints their welcome checklist and social guide answers, including requested channels. Read-only.
