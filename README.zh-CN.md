<div align="center">

<img src="docs/banner.png" alt="Mochi：为 Discord、Telegram、Slack、QQ 和你的网站打造专属 AI 聊天机器人" width="100%" />

<h3>为 Discord、Telegram、Slack、QQ 和你的网站，打造专属 AI 聊天机器人。</h3>

记得每个人的群聊伙伴、根据你的文档回答问题的客服机器人，再加一个把每一分钱都管得明明白白的控制台。

[![CI](https://github.com/flatkey-ai/Mochi-ai-chatbot/actions/workflows/ci.yml/badge.svg)](https://github.com/flatkey-ai/Mochi-ai-chatbot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-ff6fae.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-a98bff.svg)](https://nodejs.org)
[![Powered by Flatkey](https://img.shields.io/badge/powered%20by-flatkey-2a2233.svg)](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_badge_zh)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-2fb380.svg)](CONTRIBUTING.md)

[English](README.md) · **简体中文** · [日本語](README.ja-JP.md) · [Português](README.pt-BR.md)

[快速开始](#quick-start) · [人设](#persona) · [知识库](#knowledge-base) · [渠道](#channels) · [成本](#costs) · [部署](#deploy)

由 [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_header_zh) 驱动：**官方模型，更优价格。**

</div>

---

Mochi 是一个开源的聊天机器人平台，只需一把 [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_intro_zh) API 密钥，几分钟就能部署。想建多少个机器人都可以：每个都有自己的人设和简介、知识库、渠道和预算，全部在控制台里点一点就能配置，不用写代码。

![我的机器人](docs/bots.png)

## 为什么 Mochi 跑在 Flatkey 上

好的聊天机器人不只用一个模型。每个 Mochi 机器人都要调用**好几种模型**：对话、识图、联网搜索，再加一个便宜的小模型来维护记忆。如果直连各家，每家都得单独开账号、拿密钥、充值、对账。所以 Mochi 构建在 AI API 网关之上，并且只跑在 Flatkey 上。

| | |
|---|---|
| 💸 **省钱** | GPT、Claude、DeepSeek、Kimi、GLM 等主流模型**至少比官方价格低 20%**。同样是官方模型，质量与直连各家一致。调用失败不收费（$0）。 |
| ⏱️ **省时** | 100+ 模型，覆盖文本、图像、视频、音频，你的所有机器人共用**一把密钥、一个余额、一张账单**。不用在每家服务商分别注册。 |
| 🔀 **随心切换** | 任意机器人的任意能力，都能在控制台一键更换模型。无需重新注册，也不用改代码。 |

**官方模型，更优价格。** [获取 Flatkey 密钥 →](https://console.flatkey.ai/keys?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_why_zh)

## 功能一览

| | 功能 | 说明 |
|---|---|---|
| 🤖 | **多个机器人** | 一台服务器上同时运行群聊伙伴、客服机器人和学习伙伴。每个都有独立的人设、知识、渠道、记忆、模型和每日预算。可以从预设开始，也可以从零创建。 |
| 🎭 | **人设与简介** | 名称、头像、颜色、对外简介、欢迎语、性格、语气、表情用量、回复长度、语言、背景故事和规则，也可以完全自己写提示词。简介会同步到 Telegram 和 Discord 的机器人资料。 |
| 📚 | **知识库** | 上传文档（PDF、Word、Markdown、文本、CSV、JSON、HTML）、粘贴文本或导入网页，就是一个问答机器人。打开“仅根据知识库回答”，机器人就不会瞎猜。 |
| 🔌 | **渠道** | 在控制台连接 QQ、Discord、Telegram、Slack。Token 保存前会先向各平台验证，每个机器人还有一行代码就能嵌入的网站聊天窗口。 |
| 🧠 | **记忆** | 记住聊天里的每个人（性格、分享过的事、兴趣）以及每个群在聊什么。后台小模型每 N 条消息更新一次。 |
| 🔎 | **联网搜索** | 遇到不确定的事实会通过 Flatkey 上网查，并附上来源。不需要额外的搜索 API 密钥。 |
| 🖼️ | **识图** | 用你选的识图模型看懂截图、表情包和照片。 |
| 🌏 | **4 种语言** | 控制台、网站聊天窗口和内置回复支持中文、English、日本語、Português。机器人会用每个用户自己的语言回复。 |
| 🎛️ | **成本控制** | 每项任务单独选模型，按需开关能力，为每个机器人设置限制和每日 token 预算，按机器人、能力和模型查看用量。 |

<a id="quick-start"></a>
## 快速开始

需要 **Node.js 22.13+**。

```bash
git clone https://github.com/flatkey-ai/Mochi-ai-chatbot.git
cd Mochi-ai-chatbot
npm install
cp .env.example .env      # 设置一个足够复杂的 ADMIN_TOKEN
npm start
```

打开 **http://localhost:3000/dashboard**，输入你的 `ADMIN_TOKEN`。控制台会根据浏览器语言自动显示中文。

1. **绑定 Flatkey 密钥。** 首次进入会来到 **Flatkey API 密钥** 页面。点击 **去 Flatkey 创建密钥**（[或直接打开](https://console.flatkey.ai/keys?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_quickstart_zh)），复制密钥，粘贴后点 **绑定密钥**。Mochi 会先向 Flatkey 验证，密钥只保存在你自己的服务器上。
2. **认识 Mochi**，你的第一个机器人；或者点 **新建机器人**，选一个预设：*群聊伙伴*、*问答 / 客服机器人*、*学习伙伴* 或 *空白机器人*。
3. 在 **人设** 里**打造专属性格**：名称、头像、简介、性格、语气和规则。右侧会实时预览机器人收到的设定。
4. 在 **知识库** 里**喂资料**（可选，问答机器人的核心）。
5. 在 **渠道** 里**接入平台**：粘贴 QQ、Discord、Telegram 或 Slack 的 Token，或复制网站嵌入代码。
6. 在 **试聊** 里**聊几句试试**。

还没有 Flatkey 账号？[在这里注册](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_quickstart_zh)。

![绑定 Flatkey API 密钥](docs/bind-key.png)

<a id="persona"></a>
## 人设

![人设编辑](docs/persona.png)

决定一个机器人“是谁”的一切都在这里：

- **身份：** 名称、emoji 头像、主题色、对外**简介**和网站**欢迎语**。
- **类型：** *陪聊*（会聊天、记得人、参与群聊）或 *问答 / 客服*（根据你的知识库回答）。切换类型会自动套用合适的默认设置，之后仍可修改。
- **性格：** 性格特点、语气（俏皮、友好、专业、傲娇、温和）、表情用量、回复长度、语言、背景故事和**规则**（该做和不该做的、要回避的话题、何时转人工）。
- **高级：** 自己编写完整的系统提示词。
- **何时回复：** 私聊、被 @、提到名字或昵称时，或在群里按一定概率随机插话。

每次修改简介，都会同步到机器人的 **Telegram** 资料（简介和短简介）以及 **Discord** 应用简介。（Slack 和 QQ 不允许机器人通过 API 修改资料。）

<a id="knowledge-base"></a>
## 知识库（问答机器人）

![知识库](docs/knowledge.png)

- **添加** 文件（`.pdf .docx .md .txt .csv .json .html`）、粘贴的文本或公开网页。
- **仅根据知识库回答：** 机器人只根据你的文档回答。文档里没有答案时，会用对方的语言回复你设置的兜底话术。此模式下联网搜索会关闭。
- **测试检索：** 不调用任何模型，就能看到一个问题会检索到哪些段落。
- 检索使用 SQLite 全文搜索（三元组索引），中文、日文、韩文、英文都能用，不需要向量嵌入，也不产生额外费用。机器人还有一个 `search_knowledge` 工具，可以换关键词再查一次。

<a id="channels"></a>
## 渠道

![渠道](docs/channels.png)

每个机器人连接自己的账号。控制台会一步步带你完成各平台的设置，保存前先向平台验证 Token，然后立即启动机器人。可以用开关暂停或恢复，或点 **断开连接** 删除 Token。

| 平台 | 需要粘贴 | 说明 |
|---|---|---|
| 🐧 QQ | [QQ 开放平台](https://q.qq.com/) 的 AppID + AppSecret | 官方 API，无需登录 QQ 客户端，也不需要公网地址。记得把服务器 IP 加入平台的 **IP白名单**。会回复群聊中的 @、私聊和 QQ 频道消息。上线前可先在 **沙箱配置** 中测试。 |
| 🎮 Discord | 机器人 Token | 打开 **Message Content Intent**（Mochi 会检查），连接后会得到邀请链接。 |
| ✈️ Telegram | [@BotFather](https://t.me/BotFather) 给的 Token | 如需群聊记忆，请关闭 **Group Privacy**。 |
| 💼 Slack | 机器人 Token（`xoxb-`）+ 应用级 Token（`xapp-`） | 使用 Socket Mode，不需要公网地址。控制台里列出了所需权限。 |
| 🌐 网站 | 不需要 | 复制一行嵌入代码即可。可在 **允许的网站** 中限制为你自己的域名。 |

```html
<script src="https://你的MOCHI服务器/widget/widget.js" data-server="https://你的MOCHI服务器" data-bot="机器人ID" defer></script>
```

聊天窗口的名称、头像、颜色、简介和欢迎语都来自机器人的人设，界面文字会跟随访客的浏览器语言（也可以加 `data-lang="zh"` 指定）。

<img src="docs/widget.png" width="560" alt="网站聊天窗口" />

> 更喜欢配置文件？在 `.env` 中设置 `QQ_APP_ID` + `QQ_APP_SECRET`、`DISCORD_BOT_TOKEN`、`TELEGRAM_BOT_TOKEN`、`SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN` 和 `FLATKEY_API_KEY` 依然有效，其中的渠道 Token 作用于第一个机器人。

<a id="costs"></a>
## 控制成本

所有调用都走你的同一个 Flatkey 余额。在每个机器人的 **模型与能力** 中：

- **每项任务单独选模型。** 每个模型字段都是一个下拉框，列出你 Flatkey 密钥可用的所有模型（与 [flatkey.ai/models](https://flatkey.ai/models?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_models_zh) 一致），按厂商分组；也可以选 **自定义模型 ID…** 输入任意 ID。新机器人默认用快速的 DeepSeek 模型对话和记忆，用 GPT 模型识图，用 Claude 模型联网搜索。
- **开关能力。** 记忆、搜索、识图都会增加调用，用不到的就关掉，立即生效。
- **每日 token 预算。** 达到上限后，机器人会礼貌地暂停到下一个 UTC 日，不再产生任何调用。
- **各项限制。** 回复长度、历史长度、记忆更新频率、每次回复的搜索次数、每条消息的图片数。

**用量与费用** 页面按天显示 token 用量，并可按机器人、能力和模型细分。填入各模型价格后还能看到预估花费。

| 能力 | 开启后的额外成本 |
|---|---|
| 记忆 | 每个聊天每 N 条消息调用 1 次记忆模型（默认 12） |
| 联网搜索 | 每次搜索调用 1 次搜索模型（每次回复的上限可设置） |
| 识图 | 仅对带图消息，消耗识图模型的图片输入 tokens |
| 知识库 | 检索本身免费；匹配到的段落会增加几百个提示词 tokens |

## 一条回复是怎么生成的

```
消息 ─▶ 存入聊天历史 ─▶ 要回复吗？（私聊 / 被 @ / 提到名字 / 随机）
          │                          │
          │ 每 N 条                   ▼
          ▼                系统提示词 = 人设（来自“人设”页）
 记忆模型（小模型，JSON）         + 聊天摘要和近期话题
 ├─ 聊天摘要 + 话题               + 群里每个人的画像
 └─ 每个人的性格、                + 匹配到的知识库段落
    经历、兴趣                    + 最近 K 条消息
                                 （+ search_knowledge、web_search、图片）
```

- 记忆和知识库都存在你服务器上的一个 SQLite 文件里（`data/mochi.db`），按机器人隔离。
- 只记住用户自己分享的事，敏感信息不会记录。
- 任何人都可以对机器人说 **“忘记我”**（或 “forget me”）来删除自己的画像和消息。管理员也可以在控制台删除人物、聊天或整个机器人。

## 常见问题

**“Couldn't reach Telegram / QQ / Discord / Slack from the computer running Mochi”**（无法连接平台）表示 Mochi 根本没收到平台的回应，所以 Token 还没被校验，并不是 Token 错了。Node 不会使用系统代理：如果你需要借助代理或 VPN（Clash、Surge、V2Ray 等）才能打开这些平台，请在 `.env` 中填写代理的 HTTP 端口并重启：

```bash
HTTPS_PROXY=http://127.0.0.1:7890
```

之后 Mochi 的 HTTP 请求（Flatkey、Telegram、Token 校验、图片、知识库导入）都会走代理。Discord、Slack 和 QQ 还会保持一条长连接（WebSocket），它不走 `HTTPS_PROXY`，请打开代理软件的 TUN / 增强模式。

**“… rejected this token”**（Token 被拒绝）才表示平台确认 Token 不对。请重新复制（Telegram 可在 @BotFather 中复制，或用 `/revoke` 生成新的）。

<a id="deploy"></a>
## 部署

**Docker**

```bash
docker build -t mochi .
docker run -d --env-file .env -p 3000:3000 -v mochi-data:/app/data mochi
```

**Railway / Render / Fly.io**：部署本仓库，设置 `ADMIN_TOKEN` 和 `PUBLIC_URL`，并把数据卷挂载到 `/app/data`，这样机器人、记忆和知识库在重启后都会保留。然后在控制台绑定 Flatkey 密钥和各渠道。

> 把控制台暴露到公网之前，请设置一个足够复杂的 `ADMIN_TOKEN`。

从 v0.1 升级？首次启动时会自动迁移你现有的机器人、设置和记忆。

## 开发

Mochi 只接受 `flatkey.ai` 的接口地址。离线开发时，`FLATKEY_BASE_URL` 可以指向本地的模拟服务：

```bash
npm run mock        # 本地模拟 Flatkey（端口 4010），不消耗额度
FLATKEY_BASE_URL=http://127.0.0.1:4010/v1 FLATKEY_API_KEY=x npm run dev
npm test            # 基于模拟服务的端到端测试
npm run typecheck
```

代码结构和新增平台的方法见 [英文 README](README.md#development) 和 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 参与贡献

欢迎提交 Bug、想法、翻译和 Pull Request，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。发现安全问题？请按 [SECURITY.md](SECURITY.md) 私下报告。

## 许可证

[MIT](LICENSE) · 由 [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_footer_zh) 团队用 🍡 打造
