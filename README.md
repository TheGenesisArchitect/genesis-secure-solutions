# Genesis Secure Solutions platform site

Next.js 16 on Vercel. Everything is noindexed while the platform is an internal preview.

| Route | What |
|---|---|
| `/` and `/film` | The Business in a Box commercial (live animated film + narration, MP4 fallback) |
| `/welcome/<token>` | A client's private welcome package: welcome film + five-step setup guide |
| `/api/progress/<token>` | GET/POST the client's setup progress (Vercel Blob, private) |

## Add the next client
1. Copy `data/clients/mendez-hollis.json`, change the fields, and generate a new token:
   `node -e "console.log(require('crypto').randomBytes(16).toString('base64url'))"`
2. Put their film and poster in `public/w/<token>/` (use web encodes, about 12 MB).
3. Register the record in `lib/clients.ts`, commit, deploy.

Tokens and prices live only in server code. Never import `lib/clients.ts` from client code.
Anyone holding a client's link can view the guide and tick steps.

## Edit the welcome page
Edit `data/templates/welcome.html`; `npm run build` bakes it into `lib/templates.ts`.
