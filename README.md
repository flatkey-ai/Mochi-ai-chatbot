<div align="center">

<img src="docs/banner.png" alt="Mochi: build your own AI chatbots for Discord, Telegram, Slack, QQ and your website" width="100%" />

<h3>Build your own AI chatbots for Discord, Telegram, Slack, QQ and your website.</h3>

Companions that remember people, Q&A bots that answer from your docs, and a dashboard that controls every cent they spend.

[![CI](https://github.com/flatkey-ai/Mochi-ai-chatbot/actions/workflows/ci.yml/badge.svg)](https://github.com/flatkey-ai/Mochi-ai-chatbot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-ff6fae.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-a98bff.svg)](https://nodejs.org)
[![Powered by Flatkey](https://img.shields.io/badge/powered%20by-flatkey-2a2233.svg)](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_badge)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-2fb380.svg)](CONTRIBUTING.md)

**English** · [简体中文](README.zh-CN.md) · [日本語](README.ja-JP.md) · [Português](README.pt-BR.md)

[🌐 Website](https://flatkey-ai.github.io/Mochi-ai-chatbot/) · [Quick start](#quick-start) · [Persona](#persona) · [Knowledge base](#knowledge-base-qa-bots) · [Channels](#channels) · [Costs](#control-your-costs) · [Deploy](#deploy)

Powered by [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_header): **Official models. Better prices.**

</div>

---

Mochi is an open-source chatbot platform you can deploy in minutes with one [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_intro) API key. Create as many bots as you like. Give each one a persona and description, a knowledge base, its own channels and its own budget, all from a dashboard and without touching code.

<img src="docs/mochi-avatar-512.png" align="right" width="210" alt="Mochi, a pink-haired anime girl waving hello" />

### Meet Mochi 🍡

Your first bot comes ready to go: **Mochi**, the cheerful regular of your group chat. She remembers everyone, looks things up, reads your memes and answers in your language. Keep her as she is, give her your own personality, or create as many other bots as you like.

Want her on your bot? Download [her avatar](docs/mochi-avatar.png) and upload it in Discord (Developer Portal → Bot), Telegram (@BotFather → `/setuserpic`) or QQ (q.qq.com).

<br clear="right" />

![Your bots](docs/bots.png)

## Why Mochi runs on Flatkey

A good chatbot isn't one model. Each Mochi bot uses **several kinds of model calls**: chat, vision to read images, web search, and a small, inexpensive model that keeps its memory up to date. Going direct means a separate account, API key, balance and invoice for each provider. That's why Mochi is built on an AI API gateway, and why it runs on Flatkey only.

| | |
|---|---|
| 💸 **Save money** | Mainstream models like GPT, Claude, DeepSeek, Kimi and GLM are **at least 20% below official pricing**. They're the same official models, at the same quality as calling each provider directly. Failed calls cost $0. |
| ⏱️ **Save time** | **One key, one balance, one bill** for 100+ models, across text, image, video and audio, for every bot you run. No signing up with every provider your bots touch. |
| 🔀 **Switch freely** | Change the model behind any ability, for any bot, from the dashboard in one click. No new signup, no code change. |

**Official models. Better prices.** [Get your Flatkey key →](https://console.flatkey.ai/keys?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_why)

## What you get

| | Feature | How it works |
|---|---|---|
| 🤖 | **Multiple bots** | Run a group-chat companion, a support bot and a study buddy on one server. Each has its own persona, knowledge, channels, memory, models and daily budget. Start from a preset or from scratch. |
| 🎭 | **Persona & description** | Name, avatar, color, public description, greeting, personality, tone, emoji level, reply length, language, backstory and rules. You can also write the whole prompt yourself. The description is synced to your Telegram and Discord bot profiles. |
| 📚 | **Knowledge base** | Make a Q&A bot by uploading docs (PDF, Word, Markdown, text, CSV, JSON, HTML), pasting text or importing a web page. Turn on *only answer from the knowledge base* and the bot never guesses. |
| 🔌 | **Channels** | Connect Discord, Telegram, Slack and QQ from the dashboard. Tokens are verified with each platform before saving, and each bot gets a one-line website widget. |
| 🧠 | **Memory** | Remembers each person in a chat (personality, things they've shared, interests) and what each room talks about. A small background model updates it every N messages. |
| 🔎 | **Web search** | Looks up facts it isn't sure about through Flatkey and answers with sources. No separate search API key needed. |
| 🖼️ | **Image reading** | Reads screenshots, memes and photos with a vision model you choose. |
| 🌏 | **4 languages** | Dashboard, website widget and built-in replies in English, Português, 日本語 and 中文. Bots reply in each user's language. |
| 🎛️ | **Cost control** | Pick a model per job, toggle abilities, set limits and a daily token budget per bot, and see usage per bot, ability and model. |

## Quick start

You need **Node.js 22.13+**.

```bash
git clone https://github.com/flatkey-ai/Mochi-ai-chatbot.git
cd Mochi-ai-chatbot
npm install
cp .env.example .env      # set a strong ADMIN_TOKEN
npm start
```

Open **http://localhost:3000/dashboard** and enter your `ADMIN_TOKEN`.

1. **Bind your Flatkey key.** You'll land on **Flatkey API key**. Click **Create a key on Flatkey** ([or open it here](https://console.flatkey.ai/keys?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_quickstart)), copy the key, paste it and click **Bind key**. Mochi verifies it with Flatkey and stores it only on your server.
2. **Meet Mochi**, your first bot, or click **New bot** and pick a preset: *Group-chat companion*, *Q&A / support bot*, *Study buddy* or *Blank*.
3. **Make it yours** in **Persona**: name, avatar, description, personality, tone and rules. A live preview shows exactly what the bot is told.
4. **Teach it** in **Knowledge base** (optional, and the core of a Q&A bot).
5. **Connect it** in **Channels**: paste a Discord, Telegram, Slack or QQ token, or copy the website snippet.
6. **Try it** in **Playground**.

New to Flatkey? [Sign up here](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_quickstart).

![Bind your Flatkey API key](docs/bind-key.png)

## Persona

![Persona editor](docs/persona.png)

Everything that makes a bot *that* bot lives here:

- **Identity:** name, emoji avatar, accent color, a public **description** and the website **greeting**.
- **Type:** *Companion* (chats, remembers people, joins conversations) or *Q&A / support* (answers from your knowledge base). Switching type applies sensible defaults, which you can still change.
- **Personality:** traits, tone (playful, friendly, professional, sassy, calm), emoji level, reply length, language, backstory and **rules** (do's and don'ts, topics to avoid, when to hand off to a human).
- **Advanced:** write the whole system prompt yourself.
- **When to reply:** DMs, @mentions, its name or nicknames, or a random chime-in chance in groups.

The description is pushed to your bot's **Telegram** profile (description and short description) and **Discord** application description whenever you change it. (Slack and QQ don't allow bots to change their profile through the API.)

## Knowledge base (Q&A bots)

![Knowledge base](docs/knowledge.png)

- **Add** files (`.pdf .docx .md .txt .csv .json .html`), pasted text, or a public web page.
- **Only answer from the knowledge base:** the bot answers strictly from your documents. If they don't cover the question, it replies with your fallback message, in the user's language. Web search is off in this mode.
- **Test retrieval:** see which passages a question would pull up, without calling any model.
- Search uses SQLite full-text search with a trigram index. It works for English, Chinese, Japanese, Korean and more, needs no embedding calls and adds no cost. The bot also gets a `search_knowledge` tool, so it can look things up again with different keywords.

## Channels

![Channels](docs/channels.png)

Each bot connects to its own accounts. The dashboard walks you through each platform, verifies the token with the platform before saving it, then starts the bot right away. Use the toggles to pause and resume, or **Disconnect** to remove a token.

| Platform | What you paste | Notes |
|---|---|---|
| 🎮 Discord | Bot token | Turn on **Message Content Intent** (Mochi checks for it). You'll get an invite link. |
| ✈️ Telegram | Token from [@BotFather](https://t.me/BotFather) | For group memory, turn **Group Privacy** off. |
| 💼 Slack | Bot token (`xoxb-`) + app-level token (`xapp-`) | Socket Mode, so no public URL needed. The dashboard lists the scopes. |
| 🐧 QQ | AppID + AppSecret from the [QQ Bot Open Platform](https://q.qq.com/) | Official API, no QQ client needed. Add your server's IP to the platform's IP allowlist. Replies to @-mentions in groups, private chats and QQ guild channels. |
| 🌐 Website | Nothing | Copy the one-line snippet. Restrict it to your domains under **Allowed sites**. |

```html
<script src="https://YOUR-MOCHI-SERVER/widget/widget.js" data-server="https://YOUR-MOCHI-SERVER" data-bot="BOT_ID" defer></script>
```

The widget takes its name, avatar, color, description and greeting from the bot's persona.

<img src="docs/widget.png" width="560" alt="Website widget" />

> Prefer config files? `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`, `QQ_APP_ID` + `QQ_APP_SECRET` and `FLATKEY_API_KEY` in `.env` still work. Channel tokens there apply to your first bot.

## Control your costs

Every call goes through your one Flatkey balance. For each bot, under **Models & abilities**:

- **Pick a model per job.** Each model field is a dropdown of every model on your Flatkey key (the same list as [flatkey.ai/models](https://flatkey.ai/models?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_models)), grouped by provider, or choose **Custom model ID…** to type any ID. New bots use a fast DeepSeek model for chat and memory, a GPT model for reading images, and a Claude model for web search.
- **Toggle abilities.** Memory, search and image reading each add calls; turn off what you don't need. Changes apply instantly.
- **Daily token budget.** Once it's reached, the bot politely goes quiet until the next UTC day, with no further calls.
- **Limits.** Reply length, history length, memory update frequency, searches per reply, images per message.

**Usage & cost** shows tokens per day, broken down by bot, ability and model. Add per-model prices to see estimated spend.

| Ability | Extra cost when on |
|---|---|
| Memory | 1 memory-model call per room every N messages (default 12) |
| Web search | 1 search-model call per search (max per reply is configurable) |
| Image reading | Image input tokens on the vision model, only for messages with images |
| Knowledge base | None for retrieval. Matching passages add a few hundred prompt tokens. |

## How a reply is built

```
message ─▶ stored in the room's history ─▶ reply? (DM / @mention / name / random)
              │                                  │
              │ every N msgs                     ▼
              ▼                       system prompt = persona (from the Persona page)
   memory model (small, JSON)                   + room summary & recent topics
   ├─ room summary + topics                     + profiles of people in the chat
   └─ per-person personality,                   + matching knowledge-base passages
      facts, interests                          + last K messages
                                                (+ search_knowledge, web_search, images)
```

- Memory and knowledge live in one SQLite file (`data/mochi.db`) on your server, scoped per bot.
- Only facts people share about themselves are kept, and sensitive traits are excluded.
- Anyone can say **"forget me"** to a bot to erase their profile and messages. Admins can delete people, rooms or whole bots from the dashboard.

## Troubleshooting

**“Couldn't reach Telegram / QQ / Discord / Slack from the computer running Mochi”** means Mochi never got an answer from the platform, so your token wasn't checked yet. Node ignores your computer's proxy settings: if the platform opens in your browser only because of a proxy or VPN app (Clash, Surge, V2Ray…), add its HTTP port to `.env` and restart:

```bash
HTTPS_PROXY=http://127.0.0.1:7890
```

Mochi then sends its HTTP traffic through the proxy: Flatkey, Telegram, token checks, images and knowledge imports. Discord, Slack and QQ also keep a live connection (a WebSocket) that doesn't go through `HTTPS_PROXY`; for those, turn on your proxy app's TUN / enhanced mode.

**“… rejected this token”** means the platform itself said the token is wrong. Copy it again (Telegram: from @BotFather, or `/revoke` to get a new one).

## Deploy

**Docker**

```bash
docker build -t mochi .
docker run -d --env-file .env -p 3000:3000 -v mochi-data:/app/data mochi
```

**Railway / Render / Fly.io**: deploy the repo, set `ADMIN_TOKEN` and `PUBLIC_URL`, and mount a volume at `/app/data` so bots, memory and knowledge survive restarts. Then bind your Flatkey key and channels in the dashboard.

> Set a strong `ADMIN_TOKEN` before exposing the dashboard to the internet.

Upgrading from v0.1? Your existing bot, settings and memory are migrated automatically on first start.

## Development

Mochi only accepts `flatkey.ai` endpoints. For offline development, `FLATKEY_BASE_URL` may point at the local mock router:

```bash
npm run mock        # fake Flatkey router on :4010, no credits used
FLATKEY_BASE_URL=http://127.0.0.1:4010/v1 FLATKEY_API_KEY=x npm run dev
npm test            # end-to-end tests against the mock
npm run typecheck
```

```
src/
  core/        brain.ts (reply logic), bots.ts (bot registry + settings), persona.ts (presets + prompt builder),
               secrets.ts (Flatkey key + channel tokens), types.ts
  channels/    manager.ts (per-bot connections, token verification, profile sync)
  adapters/    discord.ts, telegram.ts, slack.ts, qq.ts
  knowledge/   store.ts (chunking + FTS5 search), ingest.ts (files, web pages)
  memory/      store.ts (SQLite), updater.ts (background memory pass)
  abilities/   search.ts
  flatkey/     client.ts, why.ts (Flatkey-only lock, pitch, UTM links)
  server/      app.ts (dashboard API + widget API)
public/
  dashboard/   no-build dashboard (HTML/CSS/JS)
  widget/      embeddable website widget
```

Adding a platform takes one adapter: convert incoming messages to `IncomingMessage` (with the `botId`), call `brain.handle()`, and send back the reply.

## Contributing

Bug reports, ideas, translations and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Found a security issue? Please follow [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) · Made with 🍡 by the [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_footer) team
