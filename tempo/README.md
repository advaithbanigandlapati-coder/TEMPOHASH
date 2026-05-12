# Tempo

A private collaboration platform for a small team. Combines elements of Slack (channels), Discord (DMs, presence, mentions), Notion (notes with hierarchy), Google Calendar (month/week/day), and Linear (dashboard) — all with an ocean-glassmorphic aesthetic.

Built for **4 people**: Aakshat, Advaith, Abhi, Nivas.

## Stack

- **Static frontend** (vanilla ES modules, zero build step) served by Vercel
- **Serverless API routes** on Vercel (Node)
- **Supabase** for postgres + realtime
- **PeerJS Cloud** for WebRTC signaling (free)

## Security architecture

Three layers, each one independently necessary:

1. **Password gate (`/api/auth`)** — server-side comparison against `TEMPO_PASSWORD` env var. On success, signs an HMAC token and sets it as an `HttpOnly`, `Secure`, `SameSite=Lax` cookie. The cookie is the session.
2. **Authenticated data API (`/api/data`)** — every write goes through this endpoint, which validates the cookie before touching Supabase. Writes use the **service role key** server-side (never sent to browser).
3. **Read-only client** — the browser uses the Supabase **anon key** for realtime subscriptions and reads only. Even if extracted from JS, it can't write — RLS policies block anon writes.

This means: even if someone extracts the anon key from your deployed JS, they cannot vandalize your data. Writes are gated by the cookie, which is gated by the password.

## Environment variables (set in Vercel)

| Variable | Value | Notes |
|---|---|---|
| `TEMPO_PASSWORD` | `#@shBr0wn$` (or whatever) | The shared password |
| `TEMPO_SESSION_SECRET` | random 32+ char string | Used to sign session cookies. Generate with `openssl rand -base64 32` |
| `SUPABASE_URL` | `https://xxxx.supabase.co` | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | `eyJ...` | Anon/public key (sent to browser for reads) |
| `SUPABASE_SERVICE_ROLE_KEY` | `eyJ...` | Service role key (server only, never exposed) |

Apply all to Production, Preview, and Development. **Redeploy** after adding them.

## Supabase setup

Run in the SQL editor:

```sql
-- Main data table (key-value JSONB store)
create table if not exists tempo_data (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now(),
  updated_by text
);
alter table tempo_data enable row level security;

-- Anon key gets READ only. All writes blocked.
-- Server uses service_role which bypasses RLS.
create policy "anon can read" on tempo_data for select using (true);

-- Make realtime work
alter publication supabase_realtime add table tempo_data;
```

## Deploy

```bash
# from repo root
vercel --prod
```

Or push to GitHub and connect via vercel.com.

## Features

### Dashboard (command center)
Aggregated view: today's events, urgent tasks, recent activity, team online status, quick actions.

### Channels (Slack/Discord-style chat)
- Channels: `#general`, `#random`, plus custom ones
- DMs with each teammate
- @mentions, reactions, thread replies
- Unread badges, typing indicators (via presence)
- Edit/delete your own messages

### Calendar (Google Cal-style)
- Month / Week / Day views
- Click-to-create event
- Color-coded by creator
- Hours grid in week/day view

### Notes (Notion-style)
- Hierarchical pages (parent/child)
- Markdown rendering with live preview
- Auto-save

### Tasks
- Status (todo / doing / done)
- Priority (low / med / high / urgent)
- Due dates, assignee
- Sortable, filterable

### Plans Board
Higher-level plans/projects.

### Polls
Quick votes with live results.

### Ideas
Backlog with categories and likes.

### Canvas
Multi-user drawing with live cursors. Sticky notes.

### Video Calls
6-digit room codes. Up to ~6 people. Screen share + in-call chat.

### Focus
Pomodoro timer. Broadcast your focus state to the team.

### Changelog
Audit log of who did what.

## Local dev

This is a zero-build app — but to run locally with the API routes, install Vercel CLI:

```bash
npm i -g vercel
vercel dev
```

Open http://localhost:3000.
