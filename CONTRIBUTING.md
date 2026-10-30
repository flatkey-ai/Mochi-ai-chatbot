# Contributing to Mochi 🍡

Thanks for wanting to help! Bug reports, ideas, translations and pull requests are all welcome.

## Run it locally

```bash
git clone https://github.com/flatkey-ai/Mochi-ai-chatbot.git
cd Mochi-ai-chatbot
npm install
npm run mock                 # fake Flatkey router on :4010, no credits used
FLATKEY_BASE_URL=http://127.0.0.1:4010/v1 FLATKEY_API_KEY=x ADMIN_TOKEN=dev npm run dev
```

Open http://localhost:3000/dashboard and log in with `dev`.

## Before you open a pull request

```bash
npm run typecheck
npm test
```

- **Keep it small.** One change per pull request is easier to review.
- **UI text is translated.** Every string in the dashboard goes through `t("English text")`. Add a row with Português, 日本語 and 中文 to `public/dashboard/i18n.js`. `npm test` fails if one is missing.
- **Flatkey only.** Mochi talks to Flatkey endpoints only (`src/flatkey/why.ts`). Please don't add other model providers.
- **Links to flatkey.ai carry UTM tags.** Build them with `flatkeyUrl()`. A test checks this.
- **No secrets.** Never commit API keys, bot tokens or a `data/` folder.

## Adding a chat platform

Write one adapter in `src/adapters/`: turn incoming messages into an `IncomingMessage` (with the `botId`), call `brain.handle()`, and send the reply back. Then register it in `src/channels/manager.ts` (token check + start/stop) and add a setup card in `public/dashboard/app.js`. The QQ adapter (`src/adapters/qq.ts`) and its test (`test/qq.test.ts`) are a good template.

## Adding a language

Add a column to every row in `public/dashboard/i18n.js`, a language to `LANGS` in `app.js`, the widget strings in `public/widget/widget.js`, and the built-in replies in `src/core/i18n.ts`.
