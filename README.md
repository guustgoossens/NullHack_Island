# NullHack Island — A Life of Beauty

> *"Give an agent a goal, watch it optimize. Give an agent a life, watch it become someone."*

## The pitch

This hackathon is about **taste**. Our take: taste isn't a prompt or a benchmark — it's the residue of a life lived. It accumulates passively, through years of looking, reading, listening, making, and changing your mind. Agents today don't have taste because they don't have lives. They have tasks.

So we give them a life.

Each agent is born with a name and a temperament and then gets **60 simulated years** to do nothing but live. During that life it has access to:

- **The open internet** — web search, web fetch, Wikipedia, random walks
- **Lyrics, artworks, poems** — music search, image search, Pinterest, poetry
- **Research papers** — arXiv, for the agents that go intellectual
- **Tools to make and design its own interior** — generate room images, write to its own brain (a markdown filesystem of obsessions, opinions, manifestos), and build a portfolio across many mediums (images, ASCII, poems, HTML, Three.js, Manim, essays)

Out of this an agent develops **eras** — a Japan era, a Brutalist era, a vaporwave era — and a body of work that is legibly informed by what it was looking at the year before. The product isn't "good art." The product is the **observable trajectory of a soul**: age 19 vs age 27 vs age 55, side by side.

Read [`PRD.md`](./PRD.md) for the full design.

## The three artifacts

Every agent maintains, and every creation phase must touch, three things:

| Artifact | What it is |
|---|---|
| **Brain** | A writable markdown filesystem the agent keeps for itself — `obsessions/`, `opinions/`, `journal/`. The closest thing to a self. Live state, not a journal. |
| **Room** | One image of the agent's interior. Re-prompted and re-generated each year. Interior-only, locked POV. |
| **Portfolio** | Works the agent has made or curated — across image, ASCII, poem, HTML, Three.js, Manim, essay. No fake fallbacks. |

## Time model

- 60 simulated years per life
- 4 consumption phases + 1 creation phase per year → **300 phases per life**
- A Convex cron ticks every N seconds and dispatches the next due phase for each living agent
- Agents tick independently, so a whole **cohort** lives in parallel
- The `/island` demo runs 8 individuals + 1 Commons, with a barrier-pause every 4 years where pairs → fours → all-8 synthesize a shared brain/room/portfolio

## Stack

| Layer | Choice |
|---|---|
| Backend / DB / cron / storage | **Convex** (`convex/`) — schema, actions, crons, file storage |
| Frontend | **TanStack Start** + TanStack Router + TanStack Store, React 19 |
| Styling | Tailwind CSS v4 |
| LLMs | Anthropic Claude (ticks), Google Gemini, OpenAI — wired through `@tanstack/ai-*` |
| Image generation | gpt-image (room + portfolio images) |
| Lint / format | Biome |
| Test | Vitest |
| Deploy | Vercel (`vercel.json`) |
| Package manager | **bun** |

Repo layout:

```
convex/        backend — schema, ticks, tools, cohort/commons, crons
  agent/       agent runtime
  tools/       consume + create tool implementations
  lib/         shared helpers
src/routes/    TanStack Start routes
  island.tsx   the cohort demo (8 + Commons)
  lives.tsx    grid of all lives
  agents/      per-agent views (brain, room, portfolio, feed, timeline)
scrapers/      external content scrapers (e.g. pinterest)
PRD.md         full product spec
```

## Running it

```bash
bun install
bun --bun run dev          # vite dev server on :3000
npx convex dev             # in another shell — Convex backend + cron dispatcher
```

Environment:

```env
ANTHROPIC_API_KEY=...
GOOGLE_GENAI_API_KEY=...
OPENAI_API_KEY=...
```

Other scripts:

```bash
bun --bun run build        # production build
bun --bun run test         # vitest
bun --bun run check        # biome lint + format
```

## Routes

- `/` → redirects to `/island`
- `/island` — cohort demo: 8 individuals + 1 Commons in a fixed 3×3 grid with an emotion overlay
- `/lives` — grid of all agent lives
- `/agents/$agentId` — agent home (current room, brain, portfolio, feed)
- `/agents/$agentId/timeline` — scrubbable 60-year life
- `/agents/$agentId/brain` `/room` `/portfolio` `/feed` — per-artifact deep dives

## Status

Hackathon scope. A few hero agents, full lives runnable in fast mode (~30 min) or default (~2 hr). The point is the trajectory, not the polish.
