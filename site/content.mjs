// Copy for the Mochi website, one entry per language.
// Positioning rules (see src/flatkey/why.ts): "Official models. Better prices.",
// "at least 20% below official pricing", never "cheapest", no free credits or trials.
// Placeholders: {fk} is replaced with a tracked Flatkey link at build time.

export const LANGS = ["en", "zh", "ja", "pt"];

export const CONTENT = {
  en: {
    htmlLang: "en",
    label: "English",
    title: "Mochi: build your own AI chatbots for Discord, Telegram, Slack, QQ and LINE",
    description:
      "Mochi is an open-source AI chatbot platform. Companions that remember people, Q&A bots that answer from your docs, web search, image reading and a cost-control dashboard. Powered by Flatkey.",
    nav: { features: "Features", how: "How it works", why: "Why Flatkey", faq: "FAQ", github: "GitHub", cta: "Get your Flatkey key" },
    hero: {
      eyebrow: "Open source · MIT · Powered by Flatkey",
      h1a: "Your own AI chatbot,",
      h1b: "in every chat.",
      sub: "Mochi remembers the people she talks to, answers from your docs, looks things up and reads images. Run as many bots as you like on Discord, Telegram, Slack, QQ, LINE and your website, all from one dashboard.",
      cta1: "Get your Flatkey key",
      cta2: "Deploy Mochi",
      cta3: "Star on GitHub",
      note: "One Flatkey key powers every model Mochi uses. Mainstream models at least 20% below official pricing.",
    },
    runsOn: "Runs on",
    demo: {
      channel: "# hangout",
      msgs: [
        { who: "u1", name: "Kenji", text: "morning! did anyone watch the launch last night?" },
        { who: "bot", text: "Morning Kenji! 🍡 You said last week you'd stay up for it. Want me to look up the highlights?" },
        { who: "u2", name: "Ana", text: "@Mochi how do I reset my password on the shop site?" },
        { who: "bot", text: "Settings → Security → Reset password. You'll get an email within a minute. (From the Help Center doc)" },
        { who: "u1", name: "Kenji", text: "[image] what's this plant? it showed up in my garden" },
        { who: "bot", text: "That's a dandelion! The leaves are edible too. Want care tips or ways to get rid of it?" },
      ],
      typing: "Mochi is typing…",
    },
    features: {
      h2: "Everything a great chatbot needs",
      sub: "Turn each ability on or off per bot, and pick the model behind it.",
      items: [
        { icon: "💭", t: "Memory", b: "Remembers who's in the room, their personalities and what you talked about recently." },
        { icon: "📚", t: "Knowledge base", b: "Add docs, FAQs or notes and get a Q&A bot that answers from them." },
        { icon: "🔎", t: "Web search", b: "Looks up facts and recent news instead of guessing." },
        { icon: "🖼️", t: "Reads images", b: "Understands screenshots, photos and memes people send." },
        { icon: "🤖", t: "Multiple bots", b: "Each bot has its own persona, description, channels and budget." },
        { icon: "💬", t: "6 channels", b: "Discord, Telegram, Slack, QQ, LINE and a widget for your website." },
        { icon: "🌏", t: "4 languages", b: "Dashboard in English, 中文, 日本語 and Português." },
        { icon: "🪙", t: "Cost control", b: "Switch abilities off, choose cheaper models and watch spending per bot." },
      ],
    },
    how: {
      h2: "Live in three steps",
      steps: [
        { t: "Get a Flatkey key", b: "Create an API key on Flatkey and top up your balance. It powers chat, vision, search and memory." },
        { t: "Deploy Mochi", b: "Run it with Docker, on Sealos, on any VPS or on your own computer. It needs an always-on server." },
        { t: "Connect and chat", b: "Paste your key in the dashboard, set a persona, add knowledge and connect your channels." },
      ],
      code: "git clone https://github.com/flatkey-ai/Mochi-ai-chatbot\ncd Mochi-ai-chatbot && npm install\ncp .env.example .env && npm start\n# open http://localhost:3000/dashboard",
      deployGuide: "Deploy guide (Docker, Sealos)",
    },
    why: {
      h2: "Why Mochi runs on Flatkey",
      slogan: "Official models. Better prices.",
      lead: "A chatbot needs several kinds of models. Flatkey gives you all of them behind one key.",
      points: [
        { t: "Save money", b: "Mainstream models like GPT, Claude, DeepSeek, Kimi and GLM are at least 20% below official pricing. Same official models, same quality. Failed calls cost $0." },
        { t: "Save time", b: "Chat, vision, web search and a low-cost model for memory. Going direct means one account and invoice per provider. Flatkey is one key, one balance and one bill for 100+ models." },
        { t: "Switch freely", b: "Change the model behind any ability from the dashboard in one click. No new signup, no code change." },
      ],
      cta: "Create your Flatkey key",
    },
    shots: {
      h2: "A dashboard anyone can use",
      items: [
        { img: "bots.png", c: "All your bots in one place" },
        { img: "persona.png", c: "Persona and description" },
        { img: "knowledge.png", c: "Knowledge base for Q&A" },
        { img: "channels.png", c: "Connect your channels" },
      ],
    },
    uses: {
      h2: "What will your bot be?",
      items: [
        { icon: "🎮", t: "Community companion", b: "A friendly regular for your Discord or Telegram group who knows everyone by name." },
        { icon: "🛟", t: "Support Q&A bot", b: "Answers customer questions from your docs on your website, LINE or Slack, around the clock." },
        { icon: "📖", t: "Study buddy", b: "Explains, quizzes and looks things up for a class or study group on QQ or Discord." },
      ],
    },
    faq: {
      h2: "Questions",
      items: [
        { q: "Is Mochi free?", a: "Mochi is open source under the MIT license. You pay only for the model usage your bots make, from your Flatkey balance. Turn abilities off or pick lower-cost models to spend less." },
        { q: "Why only Flatkey and not my own OpenAI key?", a: "A chatbot uses chat, vision, search and memory models from different providers. Flatkey puts 100+ official models behind one key and one bill, with mainstream models at least 20% below official pricing. That keeps Mochi simple to set up and to run." },
        { q: "Do I need to code?", a: "No. You run one command (or a Docker container), then do everything else in the dashboard: personas, knowledge, channels and models." },
        { q: "Where is my data stored?", a: "On your own server, in a local database file. Mochi sends messages to Flatkey only to get model replies." },
        { q: "Can I host it on Vercel or another serverless platform?", a: "No. Bots keep live connections to Discord, Telegram and others, so Mochi needs an always-on process and disk. Use Docker, Sealos, a VPS or your own computer." },
        { q: "Which models can I use?", a: "Any model in the Flatkey catalog, including GPT, Claude, Gemini, DeepSeek, Kimi and GLM. Mochi starts with a fast, low-cost DeepSeek model and you can change it any time." },
      ],
    },
    final: { h2: "Bring Mochi to your community today", sub: "Get a Flatkey key, deploy Mochi and say hi.", cta: "Get your Flatkey key", cta2: "View on GitHub" },
    footer: { tag: "Open-source AI chatbots, powered by Flatkey.", contact: "Contact Flatkey", license: "MIT License" },
  },

  zh: {
    htmlLang: "zh-CN",
    label: "简体中文",
    title: "Mochi:为 Discord、Telegram、Slack、QQ 和 LINE 打造你自己的 AI 聊天机器人",
    description:
      "Mochi 是开源的 AI 聊天机器人平台。会记住群友的陪伴机器人、基于你的文档回答问题的问答机器人、联网搜索、识图,以及控制成本的管理后台。由 Flatkey 驱动。",
    nav: { features: "功能", how: "使用方式", why: "为什么用 Flatkey", faq: "常见问题", github: "GitHub", cta: "获取 Flatkey 密钥" },
    hero: {
      eyebrow: "开源 · MIT 协议 · 由 Flatkey 驱动",
      h1a: "你自己的 AI 聊天机器人,",
      h1b: "出现在每个群聊里。",
      sub: "Mochi 记得和她聊过天的每个人,能根据你的文档回答问题,会联网搜索,也看得懂图片。在 Discord、Telegram、Slack、QQ、LINE 和你的网站上运行任意多个机器人,一个后台全部管理。",
      cta1: "获取 Flatkey 密钥",
      cta2: "部署 Mochi",
      cta3: "在 GitHub 点星",
      note: "一个 Flatkey 密钥驱动 Mochi 用到的所有模型。主流模型至少比官方价格低 20%。",
    },
    runsOn: "支持平台",
    demo: {
      channel: "# 闲聊",
      msgs: [
        { who: "u1", name: "小林", text: "早!昨晚的发布会有人看了吗?" },
        { who: "bot", text: "早呀小林!🍡 你上周说要熬夜看的。要我帮你查一下亮点吗?" },
        { who: "u2", name: "阿安", text: "@Mochi 商城的密码怎么重置?" },
        { who: "bot", text: "设置 → 安全 → 重置密码,一分钟内会收到邮件。(来自帮助中心文档)" },
        { who: "u1", name: "小林", text: "[图片] 这是什么植物?花园里突然长出来的" },
        { who: "bot", text: "这是蒲公英!叶子还能吃哦。要养护建议还是除掉它的方法?" },
      ],
      typing: "Mochi 正在输入…",
    },
    features: {
      h2: "好用的聊天机器人需要的,这里都有",
      sub: "每个机器人的每项能力都可以单独开关,并选择背后的模型。",
      items: [
        { icon: "💭", t: "记忆", b: "记得群里有谁、每个人的性格,以及最近聊过的话题。" },
        { icon: "📚", t: "知识库", b: "上传文档、FAQ 或笔记,就得到一个基于它们回答的问答机器人。" },
        { icon: "🔎", t: "联网搜索", b: "查找事实和最新消息,而不是瞎猜。" },
        { icon: "🖼️", t: "识图", b: "看得懂大家发来的截图、照片和表情包。" },
        { icon: "🤖", t: "多个机器人", b: "每个机器人都有自己的人设、简介、渠道和预算。" },
        { icon: "💬", t: "6 个渠道", b: "Discord、Telegram、Slack、QQ、LINE,以及网站聊天窗口。" },
        { icon: "🌏", t: "4 种语言", b: "后台支持 English、中文、日本語 和 Português。" },
        { icon: "🪙", t: "成本控制", b: "关闭不需要的能力、选择更便宜的模型,按机器人查看花费。" },
      ],
    },
    how: {
      h2: "三步上线",
      steps: [
        { t: "获取 Flatkey 密钥", b: "在 Flatkey 创建 API 密钥并充值余额。聊天、识图、搜索和记忆都靠它。" },
        { t: "部署 Mochi", b: "用 Docker、Sealos、任意 VPS 或你自己的电脑运行。需要一台一直在线的服务器。" },
        { t: "连接并开聊", b: "在后台填入密钥,设置人设,添加知识,连接你的渠道。" },
      ],
      code: "git clone https://github.com/flatkey-ai/Mochi-ai-chatbot\ncd Mochi-ai-chatbot && npm install\ncp .env.example .env && npm start\n# 打开 http://localhost:3000/dashboard",
      deployGuide: "部署指南(Docker、Sealos)",
    },
    why: {
      h2: "为什么 Mochi 只用 Flatkey",
      slogan: "官方模型,更好的价格。",
      lead: "聊天机器人需要好几类模型。Flatkey 用一个密钥把它们全部给你。",
      points: [
        { t: "省钱", b: "GPT、Claude、DeepSeek、Kimi、GLM 等主流模型至少比官方价格低 20%。同样的官方模型,同样的质量。调用失败不收费。" },
        { t: "省时间", b: "聊天、识图、联网搜索,再加一个低成本的记忆模型。直连就要每家各开账号、各付账单。Flatkey 一个密钥、一份余额、一张账单,覆盖 100+ 模型。" },
        { t: "随时切换", b: "在后台一键更换任意能力背后的模型。不用重新注册,不用改代码。" },
      ],
      cta: "创建你的 Flatkey 密钥",
    },
    shots: {
      h2: "人人都会用的后台",
      items: [
        { img: "bots.png", c: "所有机器人一目了然" },
        { img: "persona.png", c: "人设与简介" },
        { img: "knowledge.png", c: "问答知识库" },
        { img: "channels.png", c: "连接你的渠道" },
      ],
    },
    uses: {
      h2: "你的机器人会是什么样?",
      items: [
        { icon: "🎮", t: "社群陪伴", b: "Discord、Telegram 或 QQ 群里那个叫得出每个人名字的热心群友。" },
        { icon: "🛟", t: "客服问答", b: "在网站、LINE 或 Slack 上根据你的文档全天候回答客户问题。" },
        { icon: "📖", t: "学习伙伴", b: "在 QQ 或 Discord 学习群里讲解、出题、查资料。" },
      ],
    },
    faq: {
      h2: "常见问题",
      items: [
        { q: "Mochi 免费吗?", a: "Mochi 基于 MIT 协议开源。你只需为机器人产生的模型用量付费,从 Flatkey 余额扣除。关闭部分能力或选择低成本模型就能少花钱。" },
        { q: "为什么只能用 Flatkey,不能用我自己的 OpenAI 密钥?", a: "聊天机器人要用到来自不同厂商的聊天、识图、搜索和记忆模型。Flatkey 把 100+ 官方模型放在一个密钥、一张账单里,主流模型至少比官方价格低 20%。这让 Mochi 配置和运行都很简单。" },
        { q: "需要会写代码吗?", a: "不需要。运行一条命令(或一个 Docker 容器),其余都在后台完成:人设、知识、渠道和模型。" },
        { q: "我的数据存在哪里?", a: "存在你自己的服务器上,一个本地数据库文件里。Mochi 只在需要模型回复时把消息发给 Flatkey。" },
        { q: "能部署在 Vercel 或其他 Serverless 平台吗?", a: "不能。机器人要和 Discord、Telegram 等保持长连接,所以 Mochi 需要一直运行的进程和磁盘。请用 Docker、Sealos、VPS 或你自己的电脑。" },
        { q: "可以用哪些模型?", a: "Flatkey 目录里的任意模型,包括 GPT、Claude、Gemini、DeepSeek、Kimi 和 GLM。Mochi 默认使用一个快速、低成本的 DeepSeek 模型,随时可以更换。" },
      ],
    },
    final: { h2: "今天就把 Mochi 带进你的社群", sub: "获取 Flatkey 密钥,部署 Mochi,跟她打个招呼。", cta: "获取 Flatkey 密钥", cta2: "在 GitHub 查看" },
    footer: { tag: "开源 AI 聊天机器人,由 Flatkey 驱动。", contact: "联系 Flatkey", license: "MIT 协议" },
  },

  ja: {
    htmlLang: "ja",
    label: "日本語",
    title: "Mochi:Discord・Telegram・Slack・QQ・LINE で動く自分だけの AI チャットボット",
    description:
      "Mochi はオープンソースの AI チャットボットプラットフォームです。人を覚えるコンパニオン、ドキュメントから答える Q&A ボット、Web 検索、画像読み取り、コスト管理ダッシュボード。Flatkey で動きます。",
    nav: { features: "機能", how: "使い方", why: "Flatkey を使う理由", faq: "よくある質問", github: "GitHub", cta: "Flatkey キーを取得" },
    hero: {
      eyebrow: "オープンソース · MIT · Powered by Flatkey",
      h1a: "あなただけの AI チャットボットを、",
      h1b: "すべてのチャットに。",
      sub: "Mochi は話した相手のことを覚え、あなたのドキュメントから答え、調べものをして、画像も読み取ります。Discord、Telegram、Slack、QQ、LINE、そしてあなたのサイトで、好きなだけボットを動かせます。管理はひとつのダッシュボードで。",
      cta1: "Flatkey キーを取得",
      cta2: "Mochi をデプロイ",
      cta3: "GitHub でスター",
      note: "Mochi が使うすべてのモデルを Flatkey のキー 1 つで。主要モデルは公式価格より 20% 以上お得です。",
    },
    runsOn: "対応プラットフォーム",
    demo: {
      channel: "# 雑談",
      msgs: [
        { who: "u1", name: "ケンジ", text: "おはよう!昨日の発表会見た人いる?" },
        { who: "bot", text: "おはよう、ケンジ!🍡 先週、夜ふかしして見るって言ってたよね。ハイライトを調べようか?" },
        { who: "u2", name: "アナ", text: "@Mochi ショップのパスワードってどうリセットするの?" },
        { who: "bot", text: "設定 → セキュリティ → パスワードをリセット。1 分以内にメールが届くよ。(ヘルプセンターのドキュメントより)" },
        { who: "u1", name: "ケンジ", text: "[画像] この植物なに?庭に生えてきた" },
        { who: "bot", text: "タンポポだよ!葉っぱは食べられるんだ。育て方と抜き方、どっちが知りたい?" },
      ],
      typing: "Mochi が入力中…",
    },
    features: {
      h2: "いいチャットボットに必要なもの、全部入り",
      sub: "能力はボットごとにオン・オフでき、使うモデルも選べます。",
      items: [
        { icon: "💭", t: "記憶", b: "誰がいるか、それぞれの性格、最近の話題を覚えています。" },
        { icon: "📚", t: "ナレッジベース", b: "ドキュメントや FAQ、メモを追加すれば、それをもとに答える Q&A ボットに。" },
        { icon: "🔎", t: "Web 検索", b: "当てずっぽうではなく、事実や最新ニュースを調べて答えます。" },
        { icon: "🖼️", t: "画像の読み取り", b: "送られてきたスクショ、写真、ミームを理解します。" },
        { icon: "🤖", t: "複数のボット", b: "ボットごとにペルソナ、説明、チャンネル、予算を設定できます。" },
        { icon: "💬", t: "6 つのチャンネル", b: "Discord、Telegram、Slack、QQ、LINE、そしてサイト用ウィジェット。" },
        { icon: "🌏", t: "4 言語", b: "ダッシュボードは English、中文、日本語、Português に対応。" },
        { icon: "🪙", t: "コスト管理", b: "不要な能力をオフにし、安いモデルを選び、ボットごとの支出を確認。" },
      ],
    },
    how: {
      h2: "3 ステップで公開",
      steps: [
        { t: "Flatkey キーを取得", b: "Flatkey で API キーを作成し、残高をチャージ。チャット、画像、検索、記憶すべてに使います。" },
        { t: "Mochi をデプロイ", b: "Docker、Sealos、任意の VPS、または自分のパソコンで実行。常時稼働のサーバーが必要です。" },
        { t: "接続してチャット", b: "ダッシュボードにキーを貼り付け、ペルソナを設定し、ナレッジを追加してチャンネルを接続。" },
      ],
      code: "git clone https://github.com/flatkey-ai/Mochi-ai-chatbot\ncd Mochi-ai-chatbot && npm install\ncp .env.example .env && npm start\n# http://localhost:3000/dashboard を開く",
      deployGuide: "デプロイガイド(Docker、Sealos)",
    },
    why: {
      h2: "Mochi が Flatkey で動く理由",
      slogan: "公式モデルを、もっといい価格で。",
      lead: "チャットボットには何種類ものモデルが必要です。Flatkey ならキー 1 つで全部そろいます。",
      points: [
        { t: "お金を節約", b: "GPT、Claude、DeepSeek、Kimi、GLM などの主要モデルが公式価格より 20% 以上お得。同じ公式モデル、同じ品質です。失敗したリクエストは無料。" },
        { t: "時間を節約", b: "チャット、画像、Web 検索、そして記憶用の低コストモデル。直接契約だとプロバイダーごとにアカウントと請求書が必要です。Flatkey なら 100 以上のモデルがキー 1 つ、残高 1 つ、請求 1 つ。" },
        { t: "自由に切り替え", b: "どの能力のモデルも、ダッシュボードからワンクリックで変更。新規登録もコード変更も不要。" },
      ],
      cta: "Flatkey キーを作成",
    },
    shots: {
      h2: "誰でも使えるダッシュボード",
      items: [
        { img: "bots.png", c: "すべてのボットをひとつの場所に" },
        { img: "persona.png", c: "ペルソナと説明" },
        { img: "knowledge.png", c: "Q&A 用ナレッジベース" },
        { img: "channels.png", c: "チャンネルを接続" },
      ],
    },
    uses: {
      h2: "あなたのボットは何になる?",
      items: [
        { icon: "🎮", t: "コミュニティの仲間", b: "Discord や Telegram のグループで、みんなの名前を覚えている気さくな常連。" },
        { icon: "🛟", t: "サポート Q&A ボット", b: "サイト、LINE、Slack で、ドキュメントをもとにお客様の質問に 24 時間回答。" },
        { icon: "📖", t: "勉強仲間", b: "Discord や QQ の勉強グループで、解説やクイズ、調べものを手伝います。" },
      ],
    },
    faq: {
      h2: "よくある質問",
      items: [
        { q: "Mochi は無料ですか?", a: "Mochi は MIT ライセンスのオープンソースです。支払うのはボットが使ったモデルの利用料だけで、Flatkey の残高から引かれます。能力をオフにしたり低コストのモデルを選べば、さらに抑えられます。" },
        { q: "なぜ Flatkey だけで、自分の OpenAI キーは使えないのですか?", a: "チャットボットは、異なるプロバイダーのチャット・画像・検索・記憶のモデルを使います。Flatkey は 100 以上の公式モデルをキー 1 つと請求 1 つにまとめ、主要モデルは公式価格より 20% 以上お得です。だから Mochi はセットアップも運用もシンプルです。" },
        { q: "プログラミングは必要ですか?", a: "いいえ。コマンド 1 つ(または Docker コンテナ)を起動するだけで、あとはペルソナ、ナレッジ、チャンネル、モデルまで全部ダッシュボードで設定できます。" },
        { q: "データはどこに保存されますか?", a: "あなた自身のサーバー上の、ローカルのデータベースファイルに保存されます。Mochi がメッセージを Flatkey に送るのは、モデルの返答を得るときだけです。" },
        { q: "Vercel などのサーバーレスでホストできますか?", a: "できません。ボットは Discord や Telegram などと常時接続するため、常に動くプロセスとディスクが必要です。Docker、Sealos、VPS、または自分のパソコンを使ってください。" },
        { q: "どのモデルが使えますか?", a: "GPT、Claude、Gemini、DeepSeek、Kimi、GLM など、Flatkey カタログのどのモデルでも使えます。初期設定は高速で低コストな DeepSeek のモデルで、いつでも変更できます。" },
      ],
    },
    final: { h2: "今日から Mochi をあなたのコミュニティに", sub: "Flatkey キーを取得して、Mochi をデプロイして、あいさつしてみよう。", cta: "Flatkey キーを取得", cta2: "GitHub で見る" },
    footer: { tag: "オープンソースの AI チャットボット。Powered by Flatkey。", contact: "Flatkey に問い合わせ", license: "MIT ライセンス" },
  },

  pt: {
    htmlLang: "pt-BR",
    label: "Português",
    title: "Mochi: crie seus próprios chatbots de IA para Discord, Telegram, Slack, QQ e LINE",
    description:
      "Mochi é uma plataforma open source de chatbots de IA. Companheiros que lembram das pessoas, bots de perguntas e respostas a partir dos seus documentos, busca na web, leitura de imagens e um painel para controlar custos. Com Flatkey.",
    nav: { features: "Recursos", how: "Como funciona", why: "Por que Flatkey", faq: "Perguntas", github: "GitHub", cta: "Pegue sua chave Flatkey" },
    hero: {
      eyebrow: "Open source · MIT · Com Flatkey",
      h1a: "Seu próprio chatbot de IA,",
      h1b: "em todo chat.",
      sub: "A Mochi lembra das pessoas com quem conversa, responde a partir dos seus documentos, pesquisa na web e lê imagens. Rode quantos bots quiser no Discord, Telegram, Slack, QQ, LINE e no seu site, tudo em um só painel.",
      cta1: "Pegue sua chave Flatkey",
      cta2: "Implantar a Mochi",
      cta3: "Dar estrela no GitHub",
      note: "Uma chave Flatkey alimenta todos os modelos que a Mochi usa. Modelos populares pelo menos 20% abaixo do preço oficial.",
    },
    runsOn: "Funciona no",
    demo: {
      channel: "# geral",
      msgs: [
        { who: "u1", name: "Kenji", text: "bom dia! alguém viu o lançamento ontem à noite?" },
        { who: "bot", text: "Bom dia, Kenji! 🍡 Semana passada você disse que ia ficar acordado pra ver. Quer que eu busque os destaques?" },
        { who: "u2", name: "Ana", text: "@Mochi como eu redefino a senha da loja?" },
        { who: "bot", text: "Configurações → Segurança → Redefinir senha. O e-mail chega em até um minuto. (Do documento da Central de Ajuda)" },
        { who: "u1", name: "Kenji", text: "[imagem] que planta é essa? apareceu no meu jardim" },
        { who: "bot", text: "É um dente-de-leão! As folhas são comestíveis. Quer dicas de cuidado ou de como tirar?" },
      ],
      typing: "Mochi está digitando…",
    },
    features: {
      h2: "Tudo o que um bom chatbot precisa",
      sub: "Ligue ou desligue cada recurso por bot e escolha o modelo por trás dele.",
      items: [
        { icon: "💭", t: "Memória", b: "Lembra quem está na conversa, a personalidade de cada um e os assuntos recentes." },
        { icon: "📚", t: "Base de conhecimento", b: "Adicione documentos, FAQs ou notas e tenha um bot que responde com base neles." },
        { icon: "🔎", t: "Busca na web", b: "Pesquisa fatos e notícias recentes em vez de chutar." },
        { icon: "🖼️", t: "Lê imagens", b: "Entende prints, fotos e memes que as pessoas mandam." },
        { icon: "🤖", t: "Vários bots", b: "Cada bot tem persona, descrição, canais e orçamento próprios." },
        { icon: "💬", t: "6 canais", b: "Discord, Telegram, Slack, QQ, LINE e um widget para o seu site." },
        { icon: "🌏", t: "4 idiomas", b: "Painel em English, 中文, 日本語 e Português." },
        { icon: "🪙", t: "Controle de custos", b: "Desligue recursos, escolha modelos mais baratos e acompanhe o gasto por bot." },
      ],
    },
    how: {
      h2: "No ar em três passos",
      steps: [
        { t: "Pegue uma chave Flatkey", b: "Crie uma chave de API na Flatkey e recarregue seu saldo. Ela alimenta chat, visão, busca e memória." },
        { t: "Implante a Mochi", b: "Rode com Docker, no Sealos, em qualquer VPS ou no seu computador. Ela precisa de um servidor sempre ligado." },
        { t: "Conecte e converse", b: "Cole sua chave no painel, defina uma persona, adicione conhecimento e conecte seus canais." },
      ],
      code: "git clone https://github.com/flatkey-ai/Mochi-ai-chatbot\ncd Mochi-ai-chatbot && npm install\ncp .env.example .env && npm start\n# abra http://localhost:3000/dashboard",
      deployGuide: "Guia de implantação (Docker, Sealos)",
    },
    why: {
      h2: "Por que a Mochi roda na Flatkey",
      slogan: "Modelos oficiais. Preços melhores.",
      lead: "Um chatbot precisa de vários tipos de modelo. A Flatkey entrega todos com uma única chave.",
      points: [
        { t: "Economize dinheiro", b: "Modelos populares como GPT, Claude, DeepSeek, Kimi e GLM saem pelo menos 20% abaixo do preço oficial. Os mesmos modelos oficiais, com a mesma qualidade. Chamadas com falha custam $0." },
        { t: "Economize tempo", b: "Chat, visão, busca na web e um modelo de baixo custo para memória. Direto com cada provedor, são várias contas e faturas. Na Flatkey é uma chave, um saldo e uma fatura para 100+ modelos." },
        { t: "Troque à vontade", b: "Mude o modelo de qualquer recurso no painel com um clique. Sem novo cadastro, sem mexer no código." },
      ],
      cta: "Crie sua chave Flatkey",
    },
    shots: {
      h2: "Um painel que qualquer pessoa usa",
      items: [
        { img: "bots.png", c: "Todos os seus bots em um lugar" },
        { img: "persona.png", c: "Persona e descrição" },
        { img: "knowledge.png", c: "Base de conhecimento para perguntas" },
        { img: "channels.png", c: "Conecte seus canais" },
      ],
    },
    uses: {
      h2: "O que o seu bot vai ser?",
      items: [
        { icon: "🎮", t: "Companhia da comunidade", b: "Uma presença simpática no seu grupo do Discord ou Telegram que conhece todo mundo pelo nome." },
        { icon: "🛟", t: "Bot de suporte", b: "Responde dúvidas de clientes com base nos seus documentos, no site, no LINE ou no Slack, a qualquer hora." },
        { icon: "📖", t: "Parceira de estudos", b: "Explica, faz quiz e pesquisa para uma turma ou grupo de estudos no Discord ou QQ." },
      ],
    },
    faq: {
      h2: "Perguntas",
      items: [
        { q: "A Mochi é gratuita?", a: "A Mochi é open source sob a licença MIT. Você paga só pelo uso de modelos que seus bots fazem, descontado do seu saldo Flatkey. Desligue recursos ou escolha modelos mais baratos para gastar menos." },
        { q: "Por que só Flatkey e não minha própria chave da OpenAI?", a: "Um chatbot usa modelos de chat, visão, busca e memória de provedores diferentes. A Flatkey reúne 100+ modelos oficiais em uma chave e uma fatura, com modelos populares pelo menos 20% abaixo do preço oficial. Isso deixa a Mochi simples de configurar e de manter." },
        { q: "Preciso saber programar?", a: "Não. Você roda um comando (ou um contêiner Docker) e faz o resto no painel: personas, conhecimento, canais e modelos." },
        { q: "Onde meus dados ficam?", a: "No seu próprio servidor, em um arquivo de banco de dados local. A Mochi só envia mensagens para a Flatkey para obter as respostas dos modelos." },
        { q: "Posso hospedar na Vercel ou outra plataforma serverless?", a: "Não. Os bots mantêm conexões ativas com Discord, Telegram e outros, então a Mochi precisa de um processo sempre ligado e de disco. Use Docker, Sealos, uma VPS ou o seu computador." },
        { q: "Quais modelos posso usar?", a: "Qualquer modelo do catálogo da Flatkey, incluindo GPT, Claude, Gemini, DeepSeek, Kimi e GLM. A Mochi começa com um modelo DeepSeek rápido e de baixo custo, e você pode trocar quando quiser." },
      ],
    },
    final: { h2: "Leve a Mochi para a sua comunidade hoje", sub: "Pegue uma chave Flatkey, implante a Mochi e diga oi.", cta: "Pegue sua chave Flatkey", cta2: "Ver no GitHub" },
    footer: { tag: "Chatbots de IA open source, com Flatkey.", contact: "Fale com a Flatkey", license: "Licença MIT" },
  },
};
