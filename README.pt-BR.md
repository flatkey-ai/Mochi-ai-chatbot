<div align="center">

<img src="docs/banner.png" alt="Mochi: crie seus próprios chatbots de IA para Discord, Telegram, Slack, QQ e o seu site" width="100%" />

<h3>Crie seus próprios chatbots de IA para Discord, Telegram, Slack, QQ e o seu site.</h3>

Companheiros que lembram das pessoas, bots de Q&A que respondem com base nos seus documentos e um painel que controla cada centavo gasto.

[![CI](https://github.com/flatkey-ai/Mochi-ai-chatbot/actions/workflows/ci.yml/badge.svg)](https://github.com/flatkey-ai/Mochi-ai-chatbot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-ff6fae.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522.13-a98bff.svg)](https://nodejs.org)
[![Powered by Flatkey](https://img.shields.io/badge/powered%20by-flatkey-2a2233.svg)](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_badge_pt)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-2fb380.svg)](CONTRIBUTING.md)

[English](README.md) · [简体中文](README.zh-CN.md) · [日本語](README.ja-JP.md) · **Português**

[Começo rápido](#quick-start) · [Persona](#persona) · [Base de conhecimento](#knowledge-base) · [Canais](#channels) · [Custos](#costs) · [Deploy](#deploy)

Movido a [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_header_pt): **Modelos oficiais. Preços melhores.**

</div>

---

O Mochi é uma plataforma de chatbots open source que você coloca no ar em minutos com uma única chave de API do [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_intro_pt). Crie quantos bots quiser. Cada um tem sua persona e descrição, base de conhecimento, canais e orçamento, tudo pelo painel e sem escrever código.

![Seus bots](docs/bots.png)

## Por que o Mochi roda no Flatkey

Um bom chatbot não usa um modelo só. Cada bot do Mochi faz **vários tipos de chamada**: chat, visão para ler imagens, busca na web e um modelo pequeno e barato que mantém a memória em dia. Indo direto, são uma conta, uma chave de API, um saldo e uma fatura por provedor. Por isso o Mochi foi feito sobre um gateway de API de IA, e roda só no Flatkey.

| | |
|---|---|
| 💸 **Economize dinheiro** | Modelos populares como GPT, Claude, DeepSeek, Kimi e GLM custam **pelo menos 20% menos que o preço oficial**. São os mesmos modelos oficiais, com a mesma qualidade de chamar cada provedor diretamente. Chamadas com falha custam US$ 0. |
| ⏱️ **Economize tempo** | **Uma chave, um saldo, uma fatura** para mais de 100 modelos de texto, imagem, vídeo e áudio, para todos os seus bots. Sem se cadastrar em cada provedor. |
| 🔀 **Troque à vontade** | Mude o modelo de qualquer habilidade, em qualquer bot, com um clique no painel. Sem novo cadastro, sem mudar código. |

**Modelos oficiais. Preços melhores.** [Pegue sua chave Flatkey →](https://console.flatkey.ai/keys?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_why_pt)

## O que vem incluso

| | Recurso | Como funciona |
|---|---|---|
| 🤖 | **Vários bots** | Rode um companheiro de grupo, um bot de suporte e um parceiro de estudos no mesmo servidor. Cada um com persona, conhecimento, canais, memória, modelos e orçamento diário próprios. Comece de um modelo pronto ou do zero. |
| 🎭 | **Persona e descrição** | Nome, avatar, cor, descrição pública, saudação, personalidade, tom, quantidade de emoji, tamanho da resposta, idioma, história e regras. Ou escreva o prompt inteiro você mesmo. A descrição é sincronizada com os perfis do bot no Telegram e no Discord. |
| 📚 | **Base de conhecimento** | Monte um bot de Q&A enviando documentos (PDF, Word, Markdown, texto, CSV, JSON, HTML), colando texto ou importando uma página da web. Ative *responder só com a base de conhecimento* e o bot nunca chuta. |
| 🔌 | **Canais** | Conecte Discord, Telegram, Slack e QQ pelo painel. Os tokens são verificados com cada plataforma antes de salvar, e cada bot ganha um widget de site com uma linha de código. |
| 🧠 | **Memória** | Lembra de cada pessoa da conversa (personalidade, o que contou, interesses) e do assunto de cada grupo. Um modelo pequeno atualiza tudo a cada N mensagens. |
| 🔎 | **Busca na web** | Pesquisa pelo Flatkey os fatos sobre os quais não tem certeza e responde com fontes. Não precisa de outra chave de API de busca. |
| 🖼️ | **Leitura de imagens** | Lê prints, memes e fotos com o modelo de visão que você escolher. |
| 🌏 | **4 idiomas** | Painel, widget do site e respostas internas em Português, English, 日本語 e 中文. Os bots respondem no idioma de cada usuário. |
| 🎛️ | **Controle de custos** | Escolha um modelo por tarefa, ligue e desligue habilidades, defina limites e um orçamento diário de tokens por bot, e veja o uso por bot, habilidade e modelo. |

<a id="quick-start"></a>
## Começo rápido

Você precisa do **Node.js 22.13+**.

```bash
git clone https://github.com/flatkey-ai/Mochi-ai-chatbot.git
cd Mochi-ai-chatbot
npm install
cp .env.example .env      # defina um ADMIN_TOKEN forte
npm start
```

Abra **http://localhost:3000/dashboard** e digite seu `ADMIN_TOKEN`. O painel aparece em português se esse for o idioma do seu navegador.

1. **Vincule sua chave Flatkey.** Você cai na página **Chave de API Flatkey**. Clique em **Criar chave no Flatkey** ([ou abra aqui](https://console.flatkey.ai/keys?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_quickstart_pt)), copie a chave, cole e clique em **Vincular chave**. O Mochi confere a chave com o Flatkey e a guarda só no seu servidor.
2. **Conheça o Mochi**, seu primeiro bot, ou clique em **Novo bot** e escolha um modelo: *Companheiro de grupo*, *Bot de Q&A / suporte*, *Parceiro de estudos* ou *Bot em branco*.
3. **Deixe com a sua cara** em **Persona**: nome, avatar, descrição, personalidade, tom e regras. Uma prévia ao vivo mostra exatamente o que o bot recebe.
4. **Ensine** em **Base de conhecimento** (opcional, e o coração de um bot de Q&A).
5. **Conecte** em **Canais**: cole um token do Discord, Telegram, Slack ou QQ, ou copie o código do site.
6. **Teste** no **Playground**.

Ainda não usa o Flatkey? [Cadastre-se aqui](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_quickstart_pt).

![Vincule sua chave de API Flatkey](docs/bind-key.png)

<a id="persona"></a>
## Persona

![Editor de persona](docs/persona.png)

Tudo o que faz um bot ser *aquele* bot fica aqui:

- **Identidade:** nome, avatar em emoji, cor, uma **descrição** pública e a **saudação** do site.
- **Tipo:** *Companheiro* (conversa, lembra das pessoas, participa dos grupos) ou *Q&A / suporte* (responde com base na sua base de conhecimento). Trocar o tipo aplica configurações sensatas, que você ainda pode mudar.
- **Personalidade:** traços, tom (brincalhão, amigável, profissional, atrevido, calmo), quantidade de emoji, tamanho da resposta, idioma, história e **regras** (o que fazer e não fazer, assuntos a evitar, quando passar para um humano).
- **Avançado:** escreva o prompt de sistema inteiro você mesmo.
- **Quando responder:** DMs, @menções, quando o nome ou um apelido é dito, ou uma chance de entrar na conversa no grupo.

A descrição é enviada para o perfil do bot no **Telegram** (descrição e descrição curta) e para a descrição do app no **Discord** sempre que você a altera. (Slack e QQ não permitem que bots mudem o perfil pela API.)

<a id="knowledge-base"></a>
## Base de conhecimento (bots de Q&A)

![Base de conhecimento](docs/knowledge.png)

- **Adicione** arquivos (`.pdf .docx .md .txt .csv .json .html`), texto colado ou uma página pública da web.
- **Responder só com a base de conhecimento:** o bot responde estritamente com base nos seus documentos. Se eles não cobrirem a pergunta, envia sua mensagem padrão no idioma do usuário. A busca na web fica desligada nesse modo.
- **Testar a busca:** veja quais trechos uma pergunta encontra, sem chamar nenhum modelo.
- A busca usa o full-text search do SQLite com índice trigram. Funciona em português, inglês, chinês, japonês, coreano e mais, não precisa de embeddings e não tem custo extra. O bot também tem a ferramenta `search_knowledge` para buscar de novo com outras palavras.

<a id="channels"></a>
## Canais

![Canais](docs/channels.png)

Cada bot se conecta às próprias contas. O painel guia você em cada plataforma, verifica o token antes de salvar e já liga o bot. Use os botões para pausar e retomar, ou **Desconectar** para remover um token.

| Plataforma | O que você cola | Observações |
|---|---|---|
| 🎮 Discord | Token do bot | Ative a **Message Content Intent** (o Mochi verifica). Você recebe um link de convite. |
| ✈️ Telegram | Token do [@BotFather](https://t.me/BotFather) | Para memória em grupos, desative a **Group Privacy**. |
| 💼 Slack | Token do bot (`xoxb-`) + token de app (`xapp-`) | Usa Socket Mode, então não precisa de URL pública. O painel lista os escopos. |
| 🐧 QQ | AppID + AppSecret da [QQ Bot Open Platform](https://q.qq.com/) | API oficial, sem cliente QQ. Adicione o IP do servidor à lista de IPs permitidos da plataforma. Responde @menções em grupos, chats privados e canais de guild do QQ. |
| 🌐 Site | Nada | Copie o código de uma linha. Restrinja aos seus domínios em **Sites permitidos**. |

```html
<script src="https://SEU-SERVIDOR-MOCHI/widget/widget.js" data-server="https://SEU-SERVIDOR-MOCHI" data-bot="ID_DO_BOT" defer></script>
```

O widget pega nome, avatar, cor, descrição e saudação da persona do bot. Os textos da interface seguem o idioma do navegador do visitante (ou defina com `data-lang="pt"`).

<img src="docs/widget.png" width="560" alt="Widget do site" />

> Prefere arquivos de configuração? `DISCORD_BOT_TOKEN`, `TELEGRAM_BOT_TOKEN`, `SLACK_BOT_TOKEN` + `SLACK_APP_TOKEN`, `QQ_APP_ID` + `QQ_APP_SECRET` e `FLATKEY_API_KEY` no `.env` continuam funcionando. Os tokens de canal valem para o seu primeiro bot.

<a id="costs"></a>
## Controle seus custos

Todas as chamadas saem do seu único saldo Flatkey. Em cada bot, em **Modelos e habilidades**:

- **Escolha um modelo por tarefa.** Cada campo de modelo é uma lista com todos os modelos da sua chave Flatkey (a mesma de [flatkey.ai/models](https://flatkey.ai/models?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_models_pt)), agrupados por provedor, ou escolha **ID de modelo personalizado…** para digitar qualquer ID. Bots novos usam um modelo DeepSeek rápido para chat e memória, um modelo GPT para ler imagens e um modelo Claude para busca na web.
- **Ligue e desligue habilidades.** Memória, busca e leitura de imagens fazem chamadas extras; desligue o que não precisar. Vale na hora.
- **Orçamento diário de tokens.** Quando atinge o limite, o bot fica educadamente em silêncio até o próximo dia (UTC), sem novas chamadas.
- **Limites.** Tamanho da resposta, tamanho do histórico, frequência da memória, buscas por resposta, imagens por mensagem.

**Uso e custo** mostra os tokens por dia, separados por bot, habilidade e modelo. Informe o preço de cada modelo para ver o gasto estimado.

| Habilidade | Custo extra quando ligada |
|---|---|
| Memória | 1 chamada ao modelo de memória a cada N mensagens por conversa (padrão 12) |
| Busca na web | 1 chamada ao modelo de busca por busca (o máximo por resposta é configurável) |
| Leitura de imagens | Tokens de imagem no modelo de visão, só em mensagens com imagem |
| Base de conhecimento | A busca é grátis. Os trechos encontrados somam algumas centenas de tokens ao prompt. |

## Como uma resposta é montada

```
mensagem ─▶ salva no histórico ─▶ responder? (DM / @menção / nome / aleatório)
               │                       │
               │ a cada N msgs         ▼
               ▼                prompt de sistema = persona (página Persona)
   modelo de memória (pequeno)     + resumo e assuntos recentes da conversa
   ├─ resumo + assuntos            + perfis das pessoas na conversa
   └─ personalidade, fatos e       + trechos da base de conhecimento
      interesses de cada um        + últimas K mensagens
                                   (+ search_knowledge, web_search, imagens)
```

- Memória e conhecimento ficam em um único arquivo SQLite (`data/mochi.db`) no seu servidor, separados por bot.
- Só ficam guardados os fatos que as pessoas contam sobre si mesmas; dados sensíveis são excluídos.
- Qualquer pessoa pode dizer **“me esquece”** (ou “forget me”) para o bot e apagar o próprio perfil e mensagens. Admins podem apagar pessoas, conversas ou bots inteiros pelo painel.

<a id="deploy"></a>
## Deploy

**Docker**

```bash
docker build -t mochi .
docker run -d --env-file .env -p 3000:3000 -v mochi-data:/app/data mochi
```

**Railway / Render / Fly.io**: faça o deploy do repositório, defina `ADMIN_TOKEN` e `PUBLIC_URL` e monte um volume em `/app/data` para que bots, memória e conhecimento sobrevivam a reinícios. Depois vincule sua chave Flatkey e os canais pelo painel.

> Defina um `ADMIN_TOKEN` forte antes de expor o painel na internet.

Vindo da v0.1? Seu bot, configurações e memória são migrados automaticamente na primeira inicialização.

## Desenvolvimento

O Mochi só aceita endpoints `flatkey.ai`. Para desenvolver offline, `FLATKEY_BASE_URL` pode apontar para o servidor simulado local:

```bash
npm run mock        # Flatkey simulado na porta 4010, sem gastar créditos
FLATKEY_BASE_URL=http://127.0.0.1:4010/v1 FLATKEY_API_KEY=x npm run dev
npm test            # testes de ponta a ponta com o simulador
npm run typecheck
```

Veja a estrutura do código e como adicionar uma plataforma no [README em inglês](README.md#development) e no [CONTRIBUTING.md](CONTRIBUTING.md).

## Contribuindo

Bugs, ideias, traduções e pull requests são bem-vindos. Veja o [CONTRIBUTING.md](CONTRIBUTING.md). Achou um problema de segurança? Siga o [SECURITY.md](SECURITY.md).

## Licença

[MIT](LICENSE) · Feito com 🍡 pelo time [Flatkey](https://flatkey.ai/?utm_source=mochi_bot&utm_medium=github&utm_campaign=mochi&utm_content=readme_footer_pt)
