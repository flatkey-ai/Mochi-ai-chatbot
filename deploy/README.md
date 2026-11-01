# 把 Mochi 部署到云上

## 先搞清楚一件事：Mochi 不是 Serverless 应用

| Mochi 需要 | Serverless（Vercel / Netlify / Cloudflare Workers） |
|---|---|
| 常驻进程：Discord & QQ 的 WebSocket 网关、Slack Socket Mode、Telegram 长轮询、LINE 的 webhook 端点 | 函数只在请求期间存在，返回后冻结 |
| 可写持久盘：`data/mochi.db`（SQLite，WAL）、`bots.json`、`secrets.json` | 文件系统只读，`/tmp` 每次调用即丢 |
| 后台任务：记忆更新、渠道重连、心跳、每日预算重置 | 没有后台执行 |
| 长连接：QQ 心跳 41s、Slack Socket Mode 常连、Discord 网关 | 执行时长有硬上限 |

**结论：Vercel 跑不了 bot 本体。** 可以放的只有静态部分：

- `public/widget/*` 聊天窗口 → 丢到 Vercel 当静态站（或者直接由 Mochi 自己托管，它本来就会 serve）。
- 想做反向代理/自定义域名 → 用 Vercel 的 `rewrites` 指向你真正的容器地址，但 bot 仍必须跑在容器里。

## 镜像已经发布

`.github/workflows/docker.yml` 在 `main` 上构建并推送到 GitHub Container Registry：

| tag | 何时产生 |
|---|---|
| `ghcr.io/flatkey-ai/mochi:latest` | 每次 push 到 `main` |
| `ghcr.io/flatkey-ai/mochi:sha-<短 sha>` | 每次 push（便于回滚） |
| `ghcr.io/flatkey-ai/mochi:1.2.3`、`:1.2` | 打 `v1.2.3` tag 时 |

多架构：`linux/amd64`（Sealos / Railway / Render / VPS）+ `linux/arm64`（Apple Silicon、Oracle 免费额度、Hetzner CAX）。

> **GHCR 包默认是私有的，而 `flatkey-ai` 这个组织把 Public/Internal 可见性策略禁掉了**
> （包设置里那句 *"Setting is disabled by organization administrators"*）。只有组织 **owner**
> 能在 Organization settings → Packages 里放开；admin 也不行。
>
> 三条出路，任选其一：
>
> **① 用 Docker Hub（推荐，最省事）**：仓库 → Settings → Secrets and variables → Actions 加
> `DOCKERHUB_USERNAME` + `DOCKERHUB_TOKEN`（Docker Hub 的 access token），workflow 会自动多推一份
> `docker.io/<user>/mochi:latest`，Docker Hub 的仓库默认就是公开可拉的。
>
> **② 推到自己账号的 GHCR**：同上加 `GHCR_PAT_USERNAME` + `GHCR_PAT`（PAT 勾 `write:packages`），
> workflow 会多推 `ghcr.io/<user>/mochi:latest`。个人账号的包不受组织策略限制。
>
> **③ 保持私有 + pull secret**（适合只给自己用）：
> ```bash
> kubectl create secret docker-registry ghcr-pull \
>   --docker-server=ghcr.io --docker-username=<你的 GitHub 用户名> \
>   --docker-password=<带 read:packages 的 PAT>
> ```
> 然后取消 `deploy/sealos/mochi.yaml` 里 `imagePullSecrets` 两行的注释。Sealos 的「应用管理」表单里也有
> 对应的镜像仓库账号密码字段。
>
> 不想折腾镜像仓库的话：**Zeabur / Railway / Render 直接从 GitHub 仓库构建**，完全不需要 registry。

## 能跑的地方（都支持 Dockerfile + 持久卷 + 常驻）

| 平台 | 一键程度 | 持久卷 | 免费额度 | 适合谁 |
|---|---|---|---|---|
| **Sealos** | ★★★ 图形化「应用管理」 | ✅ PVC | 有 | 国内用户、想要免费公网域名 + 自动 HTTPS |
| **Zeabur** | ★★★ 中文界面，连 GitHub 即部署 | ✅ Volume | 有试用 | 想要"像 Vercel 一样"但支持容器 |
| **Railway** | ★★★ | ✅ Volume | 试用金 | 海外、部署最快 |
| **Render** | ★★☆ | ✅ Disk（付费） | 有免费 web 服务（会休眠） | 简单 demo |
| **Fly.io** | ★★☆ 需 CLI | ✅ Volume | 有 | 要低延迟多区域 |
| **任意 VPS** | ★☆☆ 自己装 Docker | ✅ 磁盘 | — | 完全可控 |

> LINE 渠道 **必须** 有公网 HTTPS（它把事件 POST 给 webhook，不像 Slack/QQ 那样连出去）。
> 上面每个平台都会自动给一个 HTTPS 域名，所以 LINE 只有在这些平台或自建隧道下才可用。

## 三条路，从最省心开始

### A. Sealos（推荐给国内用户）

图形界面「应用管理 / App Launchpad」，不需要写 YAML：

1. **镜像**：`ghcr.io/flatkey-ai/mochi:latest`（私有就先按上一节改成 public 或配 pull secret）
2. **环境变量**：
   ```
   ADMIN_TOKEN=<32 字节随机串，见下方命令>
   PUBLIC_URL=https://<Sealos 给你的域名>
   DATA_DIR=/app/data
   PORT=3000
   ```
3. **存储**：挂一个 1Gi 的 PVC 到 `/app/data`（SQLite 和密钥都在这里，不挂就重启丢数据）
4. **外网访问**：开启，端口 3000；Sealos 会给 `https://xxx.sealos.run` 这类域名（HTTPS 自动签好）
5. 打开 `https://<域名>/dashboard/`，输入 `ADMIN_TOKEN`，绑定 Flatkey 密钥 → 渠道

> 想要声明式部署：`kubectl apply -f deploy/sealos/mochi.yaml`（先改里面的域名、镜像、ADMIN_TOKEN）。

生成 ADMIN_TOKEN：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 或
openssl rand -hex 32
```

### B. Zeabur / Railway / Render（"像 Vercel 一样"的那类）

共同步骤，三个平台几乎一致：

1. 新建项目 → **Deploy from GitHub repo** → 选这个仓库（Dockerfile 会被自动识别）
2. 加环境变量：`ADMIN_TOKEN`、`DATA_DIR=/app/data`、`PUBLIC_URL=https://<平台域名>`
3. 加持久卷：挂载点 `/app/data`，1Gi 起步
4. 生成域名（平台自带 HTTPS），把该域名填回 `PUBLIC_URL` 并重启一次
5. 打开 `https://<域名>/dashboard/`

注意：**单实例**。SQLite 不支持多副本同时写，别开 autoscale/多 replica。

### C. 自己的 VPS

```bash
git clone https://github.com/flatkey-ai/Mochi-ai-chatbot.git && cd Mochi-ai-chatbot
docker build -t mochi .
docker run -d --name mochi --restart unless-stopped \
  -p 3000:3000 \
  -v /srv/mochi-data:/app/data \
  -e ADMIN_TOKEN="$(openssl rand -hex 32)" \
  -e PUBLIC_URL=https://bot.example.com \
  mochi
```

前面放 Nginx/Caddy 做 TLS，或者用 Cloudflare Tunnel（`cloudflared tunnel --url http://localhost:3000`）拿临时域名。

## 接 LINE 时唯一要改的

绑定 LINE 后，把 webhook 填成：

```
https://<你的公网域名>/webhook/line/mochi
```

（`mochi` 是默认 bot 的 id；多机器人时用控制台 URL 里的那个 id。）先在 LINE 后台点 **Verify**，再打开 **Use webhook**。

签名校验用的是 **channel secret**，所以就算有人乱 POST，也不会进大脑 —— 但**域名必须是 HTTPS 且可公网访问**，否则 LINE 根本不给你发。

## 平台通用注意事项

| 事项 | 说明 |
|---|---|
| `PUBLIC_URL` | 必须是**外部可访问的最终地址**（含 https）：网页 widget 的嵌入代码、LINE webhook 提示、安装链接都基于它 |
| 数据卷 | 只挂 `/app/data` 一处；`mochi.db` 是 WAL 模式，卷要支持文件锁（NFS 之类不合适，Sealos/Railway 的块存储可以） |
| 副本数 | 固定 1。SQLite + 渠道会话（同一个 Telegram token 只能有一个轮询者）都不允许多实例 |
| 滚动更新 | 用 `Recreate` 而不是 `RollingUpdate`，避免新旧实例同时抢渠道连接（清单里已配置） |
| 反向代理 | 部署在 ingress 后面时，把 `trust proxy` 设成 1（`src/server/app.ts` 默认 `loopback`，仅本机反代受信） |
| 健康检查 | `/health` 不需要鉴权，可直接做 liveness/readiness |
| 密钥 | `data/secrets.json` 明文存 key/token，卷权限设 700；云厂商的加密卷更稳妥 |
