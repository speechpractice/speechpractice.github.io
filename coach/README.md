# Optional AI encouragement (Cloudflare Worker)

A tiny Cloudflare Worker that writes one short line of encouragement in the practice language,
using Cloudflare Workers AI on the free plan. The app works fully without it: every line it
needs is built in, and the AI is only used when someone turns it on in Settings.

## What is sent

Only `{ "lang": "ta", "kind": "speak" | "move", "level": "great" | "ok" | "low" | "move" }`.
No name, recording, phrases, practice style or health details. No free text from users ever
reaches the model. Each AI line is checked (length, script, no numbers or health words) before
it is returned; if a check fails or the free daily allowance runs out, the worker returns
nothing and the app uses its built-in line. No request logs are kept (`observability` off).

## One-time setup (Cloudflare dashboard, about 5 minutes)

1. In Cloudflare, open **Workers & Pages → Create → Import a repository**.
2. Pick `speechpractice/speechpractice.github.io`.
3. Set **Project name** to `speak-move-coach` and **Root directory** to `coach`. Leave the
   build command empty and the deploy command as `npx wrangler deploy`.
4. Deploy. Cloudflare shows the address, like `https://speak-move-coach.<your-name>.workers.dev`.
5. Put that address in `COACH_URL` in `index.html`. The Settings switch for AI encouragement
   appears once it is set.

After that, every push to `main` that changes `coach/` redeploys the worker automatically.

## Cost

Workers AI's free allowance is 10,000 neurons a day. One line uses roughly 10 neurons, and
approved lines are reused while the worker is warm. The app also asks at most 15 times per
person per day. On the free plan, going over the allowance does not create charges: requests
simply fail and the app falls back to its built-in lines.
