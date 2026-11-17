# legado-web

**v0.70.2** · 自托管的 Web 阅读器：导入 Legado / 「阅读」App 的书源，在浏览器里搜索、发现、追更、阅读。后端 Fastify + SQLite，前端 Vue 3 + Varlet，Docker 一条命令启动。

> **安全提醒**：本项目没有账号、权限或鉴权系统。默认只适合本机、可信局域网或 VPN 内使用。不要直接把 18080 端口暴露到公网；如果必须公网访问，请在前面加一层认证代理（Nginx Basic Auth、Authelia、Cloudflare Access 等）。详见「安全模型」。

## 目录

- [这是什么](#这是什么)
- [功能](#功能)
- [技术栈](#技术栈)
- [架构](#架构)
- [目录结构](#目录结构)
- [快速开始：Docker Compose（推荐）](#快速开始docker-compose推荐)
- [裸机部署：Node.js](#裸机部署nodejs)
- [配置参考](#配置参考)
- [反向代理、HTTPS 与 PWA](#反向代理https-与-pwa)
- [首次使用](#首次使用)
- [书源与内置语料](#书源与内置语料)
- [数据、备份与升级](#数据备份与升级)
- [HTTP API](#http-api)
- [书源规则引擎](#书源规则引擎)
- [测试](#测试)
- [安全模型](#安全模型)
- [脱敏说明](#脱敏说明)
- [故障排查](#故障排查)
- [已知限制](#已知限制)
- [给自动化代理的部署验收清单](#给自动化代理的部署验收清单)
- [致谢](#致谢)

## 这是什么

legado-web 把 Android 阅读应用 **Legado / 阅读** 的书源规则搬到服务端：

- 书源规则引擎用 TypeScript 重写，支持 CSS、XPath、JSONPath、正则、模板和 JavaScript 规则；
- 书源、书架、阅读进度、书签、笔记都存在本机 SQLite；
- 浏览器访问，前后端同源，可安装为 PWA；
- 自带 841 条书源快照，首次启动自动导入，另加 2 个内置聚合源，共 843 条；
- 不依赖任何在线账号，也不需要 Android 模拟器。

它不是 Legado 官方项目，也不包含 Legado 的 Android 代码。书源规则的兼容范围见「书源规则引擎」。

## 功能

| 模块 | 能力 |
| --- | --- |
| 搜索 | 多书源并发搜索、SSE 流式返回、书名/作者搜索、跨源结果聚合、按书源健康度过滤 |
| 发现 | 分类、榜单、分页；约 560 个书源提供发现页（数量随语料与站点状态变化） |
| 详情与换源 | 封面、简介、目录、换源、换源历史、进度锚点重定位 |
| 阅读 | 滚动/整页模式、自动阅读、7 套主题、字号/行距/页宽/字体、自定义背景、书签、批注、阅读统计 |
| 书架 | 分组、多选、追更、阅读目标、最近阅读、批量刷新 |
| 书单与历史 | 自建书单、阅读记录、热力图、单书阅读统计 |
| 书源管理 | 导入/导出、去重、批量启停、单源调试、请求探测、规则体检（搜索/发现/目录/正文） |
| 聚合源 | 内置「书山聚合」「大灰狼聚合」，支持登录、发现页和 VIP 状态识别 |
| 订阅 | 订阅远程书源 JSON、定时拉取、发布自己的书源订阅链接 |
| 替换规则 | 正文净化规则、规则测试、内置预设 |
| 导入/导出 | TXT 导入、EPUB 导入/导出（含封面与插图）、书架备份 |
| TTS | 服务端 TTS 代理与缓存；需要自备兼容的 TTS HTTP 服务，不做语音合成 |
| OPDS | 只读 OPDS 目录，KOReader、Moon+ Reader、Thorium 等可浏览书架并下载已缓存章节 |
| PWA | 可安装、离线壳、章节/目录/封面/图片缓存 |
| 部署 | Docker Compose 或裸机 Node；SQLite WAL；迁移前自动备份 |

## 技术栈

| 层 | 技术 |
| --- | --- |
| 运行时 | Node.js 22（Docker 镜像）/ 22–24（裸机），pnpm 11.1.2 |
| 后端 | Fastify 5、better-sqlite3 13、SQLite（WAL）、@fastify/static |
| 前端 | Vue 3.5、Vite 6、Varlet 3（Material 3）、Pinia 2、vue-router 4 |
| 规则引擎 | TypeScript、cheerio、xpath、jsonpath-plus、tough-cookie、undici、iconv-lite |
| 测试 | Vitest 5（83 个测试文件，687 个用例） |
| 打包 | Docker 多阶段构建，tini 做 PID 1 |

## 架构

~~~text
浏览器 / PWA (Vue 3 + Varlet + Pinia)
        │  同源 HTTP / SSE
        ▼
Fastify 5 (apps/server)
  ├─ 路由：搜索、书籍、书源、发现、订阅、OPDS、TTS、设置…
  ├─ 规则引擎 (packages/engine)：CSS / XPath / JSONPath / 正则 / JS / 模板
  ├─ SQLite (better-sqlite3, WAL)：书源、书籍、章节、进度、书签、设置
  └─ 静态站点：apps/web/dist（SPA fallback）
        │
        ▼
外部书源站点 / 聚合服务（HTTP/HTTPS）
~~~

所有书源请求都由**服务端**发出，因此不存在浏览器 CORS 问题；代价是服务端必须能访问外网，并且书源规则可以让服务端请求任意 URL（SSRF 风险，见「安全模型」）。

## 目录结构

~~~text
.
├─ apps/
│  ├─ server/              Fastify API、SQLite、迁移、种子脚本
│  └─ web/                 Vue 3 前端、PWA、阅读器
├─ packages/
│  ├─ engine/              书源规则引擎（CSS/XPath/JSONPath/JS/模板）
│  └─ shared/              前后端共享类型与常量
├─ fixtures/corpus/        内置书源语料（已脱敏）
├─ docker/                 容器入口脚本
├─ tests/                  Vitest 测试
├─ Dockerfile
├─ docker-compose.yml
├─ package.json
├─ pnpm-lock.yaml
├─ pnpm-workspace.yaml
├─ tsconfig.base.json
└─ vitest.config.ts
~~~

公开仓库不包含 data/、node_modules/、dist/、logs/、截图、内部审查报告和开发探针脚本。

## 快速开始：Docker Compose（推荐）

### 前置条件

- Docker Engine 24+ 或 Docker Desktop，Compose v2（<code>docker compose version</code> 可用）
- 2 GB 内存、约 3 GB 磁盘起步；长期使用建议 5 GB 以上（章节与图片缓存会增长）
- 18080 端口空闲
- 能访问 GitHub / npm registry（首次构建）以及书源站点（运行时）

### 启动

~~~bash
git clone https://github.com/your-name/webnovel.git
cd webnovel
docker compose up -d --build
~~~

把 your-name 换成仓库实际所属账号；已经拿到代码的话直接 cd webnovel。

首次构建会下载依赖并编译 better-sqlite3，通常需要几分钟。查看状态：

~~~bash
docker compose ps
docker compose logs -f app
~~~

### 验证

~~~bash
curl -fsS http://127.0.0.1:18080/healthz
~~~

首次启动成功时返回类似：

~~~json
{"ok":true,"sources":843,"version":"0.70.2"}
~~~

然后浏览器打开 <code>http://&lt;服务器IP&gt;:18080</code>。根路径会进入书架页 <code>/shelf</code>。

### 首次启动发生了什么

1. 入口脚本创建 /data，必要时把属主改为容器内的 node 用户。
2. 如果 /data/legado.db 不存在且 SEED_CORPUS=1，执行种子脚本：
   - 导入 fixtures/corpus/书源_规范化_全部_841站.json 中的 841 条书源；
   - 按可用性文件把状态更新为 ok 605 / retest 48 / untested 188；
3. 启动服务；ensureShushanSource() 与 ensureDahuilangSource() 再补 2 条内置聚合源。
4. 最终 **843 条书源，全部启用**；状态为 ok 607 / retest 48 / untested 188（607 = 605 条语料 + 2 条内置聚合源）。

种子只在数据库不存在时执行一次。之后重启不会重复导入。

### 常用命令

~~~bash
docker compose logs -f app          # 跟踪日志
docker compose restart app          # 重启
docker compose down                 # 停止并删除容器（数据保留在 ./data）
docker compose up -d --build        # 重新构建并启动（升级用）
docker compose exec app sh          # 进容器排查
~~~

### 修改访问端口

只改宿主机端口，容器内仍保持 18080：

~~~yaml
ports:
  - "8080:18080"
~~~

然后访问 <code>http://&lt;服务器IP&gt;:8080</code>。不要只改容器内 PORT 而不改 healthcheck，否则健康检查会失败。

### 重置数据

~~~bash
docker compose down
mv data data.bak.$(date +%F-%H%M)
docker compose up -d
~~~

这会丢失书架、进度、书签、笔记和登录状态。确认后再执行。

## 裸机部署：Node.js

### 前置条件

- Linux / macOS；Windows 建议用 WSL2
- Node.js 22 LTS 或 24（Docker 镜像固定 22）
- pnpm 11.1.2
- git、curl、python3、make、g++（better-sqlite3 原生编译）
- 能访问 npm registry 与书源站点

Ubuntu / Debian：

~~~bash
sudo apt update
sudo apt install -y git curl python3 make g++
corepack enable
corepack prepare pnpm@11.1.2 --activate
node -v      # v22.x 或 v24.x
pnpm -v      # 11.1.2
~~~

macOS：

~~~bash
xcode-select --install
brew install node@22
corepack enable
corepack prepare pnpm@11.1.2 --activate
~~~

如果 better-sqlite3 安装时找不到预编译包，会回退到本地编译；缺少 python3/make/g++ 就会失败。Node 25 等过新的版本可能没有预编译包，建议 22 或 24。

### 构建

~~~bash
git clone https://github.com/your-name/webnovel.git
cd webnovel
pnpm install --frozen-lockfile
pnpm build
~~~

<code>pnpm build</code> 的顺序是 shared → engine → web → server。不要跳过，前端静态文件和规则引擎 dist 都是运行时需要的。

### 种子（首次）

~~~bash
export DATA_DIR="$PWD/data"
pnpm seed
~~~

输出会包含 <code>total: 841</code> 和 <code>status updated: 841</code>。如果跳过这一步，启动后只有 2 条内置聚合源，搜索基本不可用。

语料不在默认位置时：

~~~bash
CORPUS_DIR=/path/to/corpus DATA_DIR=/path/to/data pnpm seed
~~~

### 启动

~~~bash
DATA_DIR="$PWD/data" PORT=18080 HOST=0.0.0.0 pnpm start
~~~

等价于：

~~~bash
DATA_DIR="$PWD/data" PORT=18080 node apps/server/dist/index.js
~~~

必须从仓库根目录启动：服务端会从当前目录向上查找 <code>pnpm-workspace.yaml</code> 来确定仓库根。生产环境建议给 <code>DATA_DIR</code> 绝对路径。

验证：

~~~bash
curl -fsS http://127.0.0.1:18080/healthz
~~~

### systemd 示例

假设代码在 /opt/webnovel，数据在 /var/lib/legado-web，运行用户为 legado：

~~~ini
[Unit]
Description=legado-web
After=network.target

[Service]
Type=simple
User=legado
Group=legado
WorkingDirectory=/opt/webnovel
Environment=NODE_ENV=production
Environment=PORT=18080
Environment=HOST=0.0.0.0
Environment=DATA_DIR=/var/lib/legado-web
Environment=LOG_LEVEL=info
ExecStart=/usr/bin/node apps/server/dist/index.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
~~~

首次部署要先创建用户和目录，再以同一用户跑种子：

~~~bash
sudo useradd --system --home /opt/webnovel --shell /usr/sbin/nologin legado
sudo mkdir -p /var/lib/legado-web
sudo chown -R legado:legado /opt/webnovel /var/lib/legado-web
sudo -u legado env DATA_DIR=/var/lib/legado-web /usr/local/bin/pnpm seed
sudo systemctl daemon-reload
sudo systemctl enable --now legado-web
sudo systemctl status legado-web
~~~

<code>pnpm</code> 的绝对路径用 <code>which pnpm</code> 查；Node 用 nvm 安装时也要写绝对路径。

### 开发模式

~~~bash
pnpm build          # 首次需要，生成 packages/*/dist
pnpm dev:server     # tsx watch，监听 18080
pnpm dev:web        # Vite，监听 5173
~~~

浏览器打开 <code>http://127.0.0.1:5173</code>。Vite 会把 /api、/healthz、/opds 代理到 127.0.0.1:18080。改前端只需 dev:web；改 packages/engine 后需要重新 build，或自己加 watch。

## 配置参考

服务端只读环境变量，不自动加载 .env。Docker Compose 会读取同目录 .env 做 **变量替换**，但不会自动把它传进容器；要传进去，请改 compose 的 <code>environment:</code> 或加 <code>env_file:</code>。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| PORT | 18080 | HTTP 监听端口 |
| HOST | 0.0.0.0 | 监听地址；只给本机用可设 127.0.0.1 |
| DATA_DIR | 仓库根/data；Docker 为 /data | SQLite、图片缓存、TTS 缓存、备份 |
| WEB_DIST | 仓库根/apps/web/dist | 前端静态文件目录 |
| CORPUS_DIR | 仓库根/fixtures/corpus | 种子语料目录 |
| LOG_LEVEL | info | fatal/error/warn/info/debug/trace/silent |
| SEED_CORPUS | 未设置 | 仅 Docker 入口脚本识别；=1 且无数据库时自动种子 |
| SHELF_REFRESH_HOURS | 6 | 书架后台刷新间隔；0 关闭 |
| SHUSHAN_NOVEL_TOKEN | 空 | 书山聚合的可选静态令牌；也可登录/更新书源后自动写入设置 |
| SHUSHAN_HOST | https://v2.vossc.com | 书山聚合 API 地址（高级） |
| SHUSHAN_RELEASE_API | https://sy.shushan.vip/api/get_sources.php | 书山书源发布接口（高级） |
| SHUSHAN_RELEASE_BASE | https://sy.shushan.vip/api/ | 书山书源下载基址（高级） |
| TZ | 容器内 Asia/Shanghai | 只影响日志/时间显示，不影响数据 |

注意：

- <code>DB_PATH</code> 不是受支持配置。仓库里的 apps/server/db.mjs 是未使用的旧脚本，服务端不会读它。
- <code>SEED_CORPUS</code> 对裸机启动无效；裸机必须显式跑 <code>pnpm seed</code>。
- 不要把 <code>DATA_DIR</code> 设成相对路径后在别的目录启动，否则会在意外位置建库。
- 书山/大灰狼的登录令牌存在 SQLite 的 settings 表里，**没有加密**；data 目录要按敏感数据保护。

### 数据目录

~~~text
data/
├─ legado.db         主库：书源、书籍、章节、进度、书签、笔记、设置
├─ legado.db-wal     SQLite WAL
├─ legado.db-shm     SQLite 共享内存
├─ backup/           迁移前自动备份的数据库
├─ img-cache/        远程封面/插图缓存
├─ local-images/     导入 EPUB 时抽取的本地图片
└─ tts/              TTS 音频缓存（上限约 200MB，按 80% 回收）
~~~

数据库是单文件，但运行中有 WAL；不要在运行中直接复制 legado.db 当备份，先停服务或用 SQLite 的在线备份。

## 反向代理、HTTPS 与 PWA

### Nginx

~~~nginx
server {
    listen 80;
    server_name reader.example.com;
    client_max_body_size 32m;

    location / {
        proxy_pass http://127.0.0.1:18080;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # 搜索/全书搜索用 SSE，必须关闭缓冲
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
~~~

- <code>client_max_body_size 32m</code>：服务端 bodyLimit 是 32MB，导入 EPUB/TXT 时不要被 Nginx 先拦掉。
- <code>proxy_buffering off</code>：不关会导致 SSE 结果攒着不吐，搜索看起来像卡住。
- <code>X-Forwarded-Proto</code>：OPDS 生成绝对链接时要用；反代终止 TLS 时必须传。

### Caddy

~~~caddy
reader.example.com {
    reverse_proxy 127.0.0.1:18080 {
        flush_interval -1
    }
}
~~~

Caddy 会自动申请 HTTPS 证书；<code>flush_interval -1</code> 同样是给 SSE 用的。

### PWA 与 HTTPS

Service Worker 只在安全上下文生效：HTTPS 或 <code>http://localhost</code>。用局域网 IP + HTTP 访问时，页面能开，但「安装到桌面/离线缓存」不会生效。要装 PWA，就给反代配 HTTPS。

### 加一层认证

项目本身没有登录。最低限度可以在 Nginx 加 Basic Auth：

~~~bash
sudo apt install -y apache2-utils
sudo htpasswd -c /etc/nginx/.htpasswd reader
~~~

然后在 server 块里加：

~~~nginx
auth_basic "legado-web";
auth_basic_user_file /etc/nginx/.htpasswd;
~~~

更稳妥的是 VPN、Tailscale、Authelia、Cloudflare Access 等。不要把无认证的 18080 直接映射到公网。

## 首次使用

1. 打开 <code>http://&lt;服务器IP&gt;:18080</code>，默认进入书架 <code>/shelf</code>。
2. 点搜索，输入书名或作者；结果按书源聚合，点一本进入详情。
3. 详情页点「加入书架」，再打开目录开始阅读；进度会自动写回服务端。
4. 阅读器右下角/设置面板可调主题、字号、行距、页宽、自动阅读和 TTS。
5. 进「书源」页：先跑一次体检，按结果停用失效源；单个源可以打开调试台看请求与规则命中。
6. 需要书山/大灰狼的发现页或 VIP 内容时，在对应入口登录；没有账号不影响普通书源搜索。
7. OPDS：<code>http://&lt;服务器IP&gt;:18080/opds</code>，在 KOReader/Moon+ Reader/Thorium 里添加为 OPDS 目录。它只读、无鉴权。
8. 手机浏览器菜单里「添加到主屏幕」即可安装 PWA（需要 HTTPS 或 localhost）。

## 书源与内置语料

### 语料文件

| 文件 | 条数 | 用途 |
| --- | --- | --- |
| fixtures/corpus/书源_规范化_全部_841站.json | 841 | 种子导入的主文件 |
| fixtures/corpus/书源_规范化_可用_605条.json | 605 | 标记为 ok |
| fixtures/corpus/书源_规范化_待复测_48条.json | 48 | 标记为 retest |
| fixtures/corpus/书源_规范化_未测_188条.json | 188 | 标记为 untested |

种子先导入 841 条（status=unknown），再按后三个文件把 status 更新为 ok/retest/untested。语料里所有书源都是启用状态，所以新库是 843 条全部启用。

**状态是导入时的快照，不代表现在还能用。** 书源站点会改版、封 IP、加验证码；部署后建议先跑体检，再按需停用。

### 导入与导出

- UI：书源页 → 导入，选择 Legado 书源 JSON。
- API：<code>POST /api/sources/import</code>，body 可以是 JSON 数组，也可以是 <code>{"sources":[...]}</code>。
- 去重：按书源 URL + 名称合并；导入结果会返回 inserted/updated/skipped 和规则审计问题。
- 导出：<code>GET /api/sources/export</code>，得到可再导入的 JSON。
- 订阅：书源页添加远程 JSON 订阅，服务端会带 ETag/Last-Modified 拉取；也可以发布自己的订阅链接 <code>/api/sub/&lt;token&gt;.json</code>。

### 调试与体检

- 单源体检：quick 只查搜索链路，full 会继续查详情/目录/正文。
- 请求探测：对单条规则发一次请求，看状态码、最终 URL、响应片段。
- 规则审计：检查搜索/发现/目录/正文的必填规则、空规则、危险 JS、正则和 header。
- 批量操作：批量启用/停用/删除、查重。
- 体检依赖外部站点，可能很慢或被限流；不要对几百个源同时跑 full。

### 兼容性与限制

支持的选择器/表达式：

- CSS 选择器（cheerio）
- XPath
- JSONPath
- 正则（含替换、捕获组）
- Legado 模板语法，如 <code>{{...}}</code>、<code>@js:</code>、<code>&lt;js&gt;</code>
- 常用 java.* API 的兼容实现（URL、编码、JSON、Cookie、时间、字符串等）
- 请求头、Cookie、代理、POST body、字符集转换

不支持或会降级：

- **WebView 规则**：服务端没有 WebView，会降级成普通 HTTP 请求；依赖 JS 渲染/签名的站点会失败。
- Android 专有 API、App 签名、设备指纹、部分 <code>source.*</code>/<code>java.*</code> 方法没有实现，会抛 <code>UNSUPPORTED_API</code>。
- 需要登录的源：在调试台手动填 Cookie/Authorization；公开语料里的静态 Cookie/Token 已脱敏删除，这类源默认会 401。
- JS 规则运行在 node:vm 里，**5 秒超时**；vm 不是硬隔离沙箱，能访问部分宿主对象。只导入你信任的书源。
- 聚合源（书山/大灰狼）需要各自账号；登录令牌明文存在 SQLite。

## 数据、备份与升级

### 备份

最稳妥的方式是停服务再打包：

~~~bash
docker compose stop app
tar -czf legado-web-data.tar.gz data
docker compose start app
~~~

裸机：

~~~bash
sudo systemctl stop legado-web
tar -czf legado-web-data.tar.gz -C /var/lib/legado-web .
sudo systemctl start legado-web
~~~

如果不想停机，用 SQLite 在线备份（需要 sqlite3 命令）：

~~~bash
sqlite3 data/legado.db ".backup 'data/backup/manual.db'"
~~~

不要直接复制正在写入的 legado.db；WAL 里可能还有未合并的数据。

### 恢复

~~~bash
docker compose down
mv data data.broken
tar -xzf legado-web-data.tar.gz
docker compose up -d
~~~

恢复后看 <code>/healthz</code> 和日志，确认迁移没有报错。

### 升级

~~~bash
git pull
docker compose up -d --build
~~~

启动时会执行数据库迁移。当前库 user_version 大于 0 且存在待执行迁移时，服务端会先做 WAL checkpoint，再把旧库备份到 <code>data/backup/legado-v&lt;版本&gt;-&lt;时间戳&gt;.db</code>。仍然建议升级前自己再备份一次。

回滚：把代码切回旧 tag/commit，恢复对应的 data 备份，再重新构建。数据库迁移通常只向前，不要用旧代码直接打开新库。

## HTTP API

所有接口都没有鉴权，能访问端口的人都能调用。下面只列常用接口；完整路由在 apps/server/src/routes/ 下。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | /healthz | 健康检查：ok、书源数、版本 |
| GET | /api/stats | 书源/书籍/阅读统计 |
| GET | /api/sources | 书源列表，支持 q/status/health/enabled/page 等查询参数 |
| POST | /api/sources/import | 导入 Legado 书源 JSON |
| GET | /api/sources/export | 导出全部书源 |
| POST | /api/sources/:id/health | 单源体检，body {"mode":"quick"} 或 {"mode":"full"} |
| POST | /api/sources/:id/request/probe | 请求探测，body {"url":"..."} |
| POST | /api/sources/audit/start | 启动批量规则审计 |
| GET | /api/sources/audit/status | 审计进度 |
| GET | /api/search | 多源搜索：key、author、sources、limit、concurrency、health |
| GET | /api/search/stream | 同上，SSE 流式返回 |
| GET | /api/explore/sources | 有发现页的书源 |
| GET | /api/explore/:sourceId/groups | 发现页分类/榜单 |
| GET | /api/explore/:sourceId/items | 发现页条目，url/page/title |
| POST | /api/books | 加入书架：sourceId、bookUrl，可带 name/author/coverUrl |
| GET | /api/books | 书架列表 |
| GET | /api/books/:id/chapters | 目录 |
| GET | /api/books/:id/chapters/:index/content | 章节正文 |
| PUT | /api/books/:id/progress | 保存进度：chapterIndex、offset、percent、charOffset |
| POST | /api/books/:id/switch | 换源 |
| GET | /api/books/:id/export?format=epub | 导出 EPUB/TXT |
| POST | /api/import/txt | 导入 TXT |
| POST | /api/import/epub | 导入 EPUB |
| GET | /api/settings | 读取设置 |
| PUT | /api/settings | 写入设置 |
| GET | /api/subscriptions | 书源订阅列表 |
| POST | /api/subscriptions/publish | 发布自己的订阅链接 |
| GET | /opds | OPDS 根目录（只读、无鉴权） |

示例：

~~~bash
# 搜索（URL 编码交给 curl）
curl -fsS --get 'http://127.0.0.1:18080/api/search' \
  --data-urlencode 'key=诡秘之主' \
  --data-urlencode 'limit=20'

# 加入书架
curl -fsS -X POST 'http://127.0.0.1:18080/api/books' \
  -H 'content-type: application/json' \
  -d '{"sourceId":123,"bookUrl":"https://example.com/book/1"}'

# 保存进度
curl -fsS -X PUT 'http://127.0.0.1:18080/api/books/1/progress' \
  -H 'content-type: application/json' \
  -d '{"chapterIndex":10,"offset":0,"percent":12.3}'

# 单源体检
curl -fsS -X POST 'http://127.0.0.1:18080/api/sources/123/health' \
  -H 'content-type: application/json' \
  -d '{"mode":"quick"}'
~~~

SSE 接口（/api/search/stream、/api/books/:id/search）返回 <code>text/event-stream</code>；反代必须关闭 buffering，客户端要按 SSE 解析，不能当普通 JSON。

## 书源规则引擎

规则引擎在 packages/engine，处理流程大致是：

1. 用 searchUrl / exploreUrl 生成请求，套 URL 模板、分页、header、Cookie、POST body；
2. 按 ruleSearch / ruleExplore 解析列表，得到书名、作者、封面、书籍 URL；
3. 进入详情页，按 ruleBookInfo 补全元数据；
4. 按 ruleToc 解析目录；
5. 按 ruleContent 抓正文，处理分页、替换规则、字符集；
6. 返回统一结构给前端。

支持：

- CSS 选择器、XPath、JSONPath、正则、Legado 模板；
- <code>@js:</code> 与 <code>&lt;js&gt;</code> 规则；
- 常用 java.* 兼容 API：URL、编码、JSON、Cookie、时间、字符串、Base64 等；
- gzip/br、字符集转换、重定向、Cookie jar、超时与重试；
- 搜索/发现/详情/目录/正文五类规则。

不支持：

- WebView 渲染与 JS 注入；
- Android 专有 API、App 签名、设备指纹；
- 需要验证码/人机校验的站点；
- 未实现的 java.* / source.* 方法会抛 <code>UNSUPPORTED_API</code>。

JS 规则在 node:vm 中执行，单次 5 秒超时。vm 不是安全边界，恶意规则可能消耗 CPU/内存或访问宿主对象；只导入可信书源。

## 测试

~~~bash
pnpm test
~~~

本仓库当前结果：

~~~text
Test Files  83 passed (83)
     Tests  687 passed (687)
~~~

测试覆盖规则解析、搜索聚合、阅读器设置、换源、缓存、EPUB/TXT、OPDS、健康度等。测试使用本地 fixture/mock，不需要真实书源站点；少数网络相关测试会起本地 HTTP 服务。

只跑某个文件：

~~~bash
pnpm test -- tests/search-health.test.ts
~~~

构建检查：

~~~bash
pnpm build
~~~

## 安全模型

**没有账号系统。** 所有页面、/api/*、/opds 都对能访问端口的人开放；没有登录、角色、权限、CSRF token 或速率限制。

主要风险：

| 风险 | 说明 | 建议 |
| --- | --- | --- |
| 未授权访问 | 任何人都能改书源、删书、看笔记、读 OPDS | 只放本机/可信 LAN/VPN；公网必须加认证代理 |
| SSRF | 书源规则可让服务端请求任意 http(s) URL，包括内网和 localhost | 把服务放在隔离网段；不要给不可信用户导入书源 |
| 恶意 JS | 规则里的 JS 在 node:vm 执行，5 秒超时，但不是硬沙箱 | 只导入可信书源；关注 CPU/内存 |
| 令牌泄露 | 书山/大灰狼登录令牌、Cookie 明文存 SQLite | data 目录 0700；备份加密；不分享数据库 |
| OPDS 泄露 | OPDS 只读但无鉴权，能列出书架并下载已缓存章节 | 不要把 /opds 暴露到公网 |
| 资源耗尽 | 搜索并发、批量体检、TTS 缓存、图片缓存都会吃 CPU/磁盘 | 限制访问来源；定期清理缓存；设置并发 |
| SQLite 单写者 | 多实例同时写同一 DATA_DIR 会锁库 | 只跑一个实例；不要用 NFS 挂 data |
| 日志泄露 | 日志可能含书源 URL、错误片段、请求头 | 分享日志前先脱敏 |

最低部署基线：

1. 应用只监听内网或 127.0.0.1；
2. 前面有 Nginx/Caddy + HTTPS；
3. 至少一层认证（Basic Auth、Authelia、VPN、Cloudflare Access）；
4. 防火墙只放行反代端口，不直接放行 18080；
5. data 目录权限 0700，备份加密；
6. 定期升级依赖与镜像。

## 脱敏说明

这个公开快照在上传前做了以下处理：

- 不收录 data/（个人书架、进度、图片缓存、TTS）、logs/、shots*/、_tmp-*、docs/（内部审查报告与截图）、tools/（含局域网地址和本机绝对路径的开发探针）。
- 书源语料清洗：
  - 删除 74 个静态敏感 header 键（cookie、authorization、device_id、q-guid、qimei36、sessionid 等）；
  - 置空 18 处静态 header 值；
  - 将 56 处静态 query token/api_key/secret/password 替换为 REDACTED；
  - 将 10 处私网 IP 替换为 192.0.2.1；
  - 将 4 处个人邮箱替换为 user@example.com。
- 动态模板（<code>{{...}}</code>、<code>@js:</code>、<code>java.*</code>）保留，因为它们不是静态密钥。
- 删除源码里硬编码的书山聚合静态令牌，改为环境变量 <code>SHUSHAN_NOVEL_TOKEN</code>；没有默认值。
- 公开仓库使用单次全新提交，不带旧开发历史。

仍然存在的非个人数据：书源站点 URL、站点名称、公开的选择器/规则、第三方站点返回的公开文本片段。若你发现仍有个人的 Cookie、Token、邮箱、内网地址，请开 issue，不要直接贴敏感值。

## 故障排查

| 现象 | 可能原因 | 处理 |
| --- | --- | --- |
| /healthz 的 sources 是 0 或 2 | 种子没跑；data 目录已有空库；SEED_CORPUS 没开 | 确认 SEED_CORPUS=1、data 为空；手动跑 seed |
| 容器一直 unhealthy | 启动报错、端口不对、/data 权限 | docker compose logs app；检查 PORT 与 healthcheck |
| /data 权限错误 | rootless Docker、NFS、宿主机 uid 不匹配 | 预建 data 并 chown 1000:1000；或改用绑定用户 |
| pnpm install 编译 better-sqlite3 失败 | 缺 python3/make/g++；Node 版本过新 | 装构建工具；换 Node 22/24 |
| 搜索很慢或没结果 | 书源失效、网络/DNS、并发过高、反代缓冲 | 跑体检；停用坏源；降 concurrency；Nginx 关 buffering |
| 某源 401/403 | 需要 Cookie/Token；语料已脱敏 | 调试台填 header/Cookie；或放弃该源 |
| 导入 EPUB 返回 413 | Nginx client_max_body_size 太小；超过 32MB | 调到 32m；拆书 |
| PWA 不能安装 | HTTP + 局域网 IP，不是安全上下文 | 配 HTTPS 或用 localhost |
| OPDS 链接是 127.0.0.1 | 反代没传 X-Forwarded-Proto/Host | 补 proxy_set_header |
| database is locked | 多实例写同一库；长事务 | 只跑一个实例；重启；检查备份任务 |
| 迁移失败 | 磁盘满、旧库损坏、权限 | 恢复 data/backup 下的备份；留日志提 issue |
| 页面 404 但 API 正常 | 没有 build 前端，或 WEB_DIST 不对 | pnpm build；检查 apps/web/dist |
| Docker 构建很慢 | 首次编译原生模块、下载依赖 | 正常；后续利用层缓存 |

## 已知限制

- 单用户、无鉴权、无多账号；不适合直接做公网服务。
- WebView 规则不支持，依赖 JS 渲染/签名的源会失败。
- 书源可用性完全依赖第三方站点；语料是快照，会过期。
- 聚合源需要账号，登录令牌明文存储。
- TTS 只做代理和缓存，必须自备兼容的上游服务。
- OPDS 只读，不能写回进度。
- SQLite 单写者；不适合多副本/多实例共享 data。
- PWA 缓存受浏览器配额限制；清除站点数据会丢离线内容。
- 不保证与 Legado Android 的所有规则/API 100% 兼容。
- 仓库目前没有 LICENSE 文件；对外分发前请先补许可证，并确认书源内容与站点条款。

## 给自动化代理的部署验收清单

按顺序执行，每步都有可判定的结果：

1. <code>docker compose up -d --build</code> 退出码 0。
2. <code>docker compose ps</code> 中 app 状态为 healthy（或 running，且 healthcheck 通过）。
3. <code>curl -fsS http://127.0.0.1:18080/healthz</code> 返回 JSON，<code>ok=true</code>，<code>sources=843</code>，<code>version=0.70.2</code>。
4. <code>curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/</code> 返回 200。
5. <code>curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:18080/api/books</code> 返回 200。
6. <code>docker compose logs app</code> 中没有 migration failed、EADDRINUSE、SQLITE_CANTOPEN。
7. 宿主机 <code>data/legado.db</code> 存在，<code>data/backup/</code> 存在。
8. 浏览器打开 <code>/shelf</code> 能看到书架页；搜索一个常见书名能返回结果（结果数取决于外网与书源状态）。
9. 如果 sources 不是 843：检查 <code>SEED_CORPUS=1</code>、<code>data/</code> 是否为空、入口脚本日志；必要时手动执行 <code>docker compose exec app node apps/server/dist/scripts/seed.js</code>。
10. 对外提供访问前，确认反代 HTTPS、认证、防火墙三项都已配置；不要直接把 18080 暴露到公网。

裸机等价检查：<code>pnpm build</code> 成功、<code>pnpm seed</code> 输出 841、<code>pnpm start</code> 后 healthz 为 843、<code>pnpm test</code> 为 83/687 通过。

## 致谢

- [Legado / 阅读](https://github.com/gedoor/legado)：书源规则与阅读体验的源头。
- 书源规则社区与语料维护者。
- Fastify、better-sqlite3、Vue、Vite、Varlet、Pinia、cheerio、xpath、jsonpath-plus、undici 等开源项目。

本项目与 Legado 官方无隶属关系。书源内容版权归各站点与作者所有；请只在当地法律与站点条款允许的范围内使用。


