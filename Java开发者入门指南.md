# Java 后端开发者的项目入门指南

> 面向读者：Java 后端开发、懂一些 Vue、没写过浏览器插件。
> 目标：看懂这个项目用了哪些技术、类比到你熟悉的概念、能在本地跑测试、能把扩展装进 Chrome。

---

## 1. 这个项目是什么

**英语拆解宝**：装到浏览器里后，它把网页上的英文段落替换成"逐句句法拆解卡片"——每个句子按语法成分（主语/谓语/宾语/定语从句……）拆开，三行对照显示「成分角色 / 原文 / 中文译文」，点击某个成分还能懒加载它的详细讲解。

拆解不是写死的规则，而是调用**任意 OpenAI 兼容的大模型 API**（DeepSeek、Ollama 本地模型等）完成的。仓库里还有第二个运行时：一个 IntelliJ IDEA 的 Markdown 预览插件（Kotlin），和 Chrome 扩展共享同一套协议与缓存格式——本指南主要讲 Chrome 侧，IDEA 侧只在最后带一句。

```
网页英文段落 → 扫描/分句/分词 → 调大模型(LLM) → JSON 校验/修复 → 渲染卡片 → 点击成分要详解(带缓存)
```

---

## 2. 给 Java 后端的技术点类比

整个 Chrome 扩展可以理解成一个"没有服务器的后端 + 注入到别人页面里的前端"：

| 你熟悉的（Java 后端） | 这个项目里的 | 说明 |
| --- | --- | --- |
| Spring Boot 应用 | **MV3 Service Worker**（`src/background/`） | 扩展的"后台"。但它是**事件驱动 + 随时可能被杀**的：Chrome 空闲 30 秒就可能回收它，下次事件再冷启动。所以不能依赖常驻内存状态，状态都落 `chrome.storage` / IndexedDB |
| 注入到客户端页面的 SDK | **Content Script**（`src/content/`） | 跑在网页上下文里的脚本，负责扫描段落、替换 DOM、渲染卡片。它**读不到 `chrome.storage`**（隔离上下文），设置必须由后台在消息里快照下发 |
| Controller + DTO + 参数校验 | **消息协议**（`src/shared/protocol.ts`） | 页面 ↔ 后台之间所有通信是带 `version`/`requestId`/`type` 的消息，协议层做**三层校验**（类型定义、SW 侧校验、content 侧守卫必须同步），漏一层会静默出错 |
| Feign/RestTemplate + Resilience4j | **模型适配器**（`openai-compatible-adapter.ts`） | 调 OpenAI 兼容端点。带一整套**能力探测与降级**：`response_format`(JSON Schema) 不支持就降级、`stream` 不支持就回落缓冲、思考模型参数被拒就换 `thinking` 开关——每种降级持久化一次，不再重复交 4xx 学费 |
| WebFlux SSE 流 | **SSE 流式解析**（`sse.ts` + 两个 stream parser） | 流式响应经 port 推到页面边生成边渲染；静默超时（每收到一片重置计时）而不是总时长超时 |
| 线程池 + 优先级队列 | **请求调度器**（`request-scheduler.ts`） | 用户点击 > 可见段落 > 预取，五档优先级；并发数就是真实在飞的模型请求数 |
| 嵌入式 DB + Caffeine | **IndexedDB 缓存**（`analysis-cache.ts`） | 缓存键 = 句文本 + 提示词版本 + focus 区间（**与模型无关**，换模型也能命中）；每次写入后按 LRU 淘汰到上限字节 |
| 配置中心 | **选项页 + chrome.storage**（`src/options/`） | 多套模型 profile（Base URL / Key / Model / 超时 / 自定义头），Key 属敏感信息不出后台 |
| WireMock | **假 OpenAI 服务器**（`tests/support/fake-openai-server.ts`） | Playwright E2E 用它模拟模型端点（按 prompt 首行识别请求类型），**E2E 不联网、不花 token** |
| JUnit | **Vitest** | 单测跑在 happy-dom（假 DOM）+ fake-indexeddb 里，1000+ 用例秒级跑完 |
| Maven/Gradle | **npm + Vite** | `package.json` 是 pom；`vite.config.ts` 是构建插件体系；TypeScript 的 `tsc --noEmit` 相当于编译期类型检查 |

注意：**项目没有用 React/Vue**。所有 UI（选项页、popup、页面上的卡片）都是原生 TypeScript 手写 DOM——没有虚拟 DOM、没有组件框架，这是刻意的（插件要往别人页面里塞样式，框架的样式隔离反而是负担）。你会 Vue 的 DOM 心智模型就够用。

---

## 3. 目录地图（chrome-plugin/）

```
chrome-plugin/
├── manifest.json              # MV3 清单：权限、入口、快捷键(Alt+T)
├── vite.config.ts             # 后台/popup/选项页的构建
├── vite.content.config.ts     # content script 单独构建(要打进页面的代码)
├── src/
│   ├── background/            # "后端"：service worker、模型适配器、调度器、缓存、协议路由
│   ├── content/               # "注入前端"：段落扫描、DOM 替换、卡片渲染、视口观察
│   ├── shared/                # 双端共享：协议、错误码、语法角色模型、缓存键版本
│   ├── language/              # 纯语言逻辑：分句/分词(segmenter)、结果校验器(validator)
│   ├── options/               # 选项页(模型配置、缓存管理)
│   └── popup/                 # 工具栏弹窗
├── tests/
│   ├── e2e/                   # Playwright：加载真扩展 + 假模型服务器跑全链路
│   └── support/               # fake-openai-server.ts 等
├── scripts/                   # 打包/发版/文档漂移检查等 node 脚本
└── shared-fixtures/  (仓库根) # TS 与 Kotlin 双端测试共吃的向量文件(分句、缓存键、黄金标注集)
```

---

## 4. 核心链路（读代码的推荐顺序）

1. `src/content/document-scanner.ts` —— 怎么在一整页里找出"值得解析的正文段落"；
2. `src/background/service-worker.ts` —— 消息路由（相当于 Controller 层），搜 `case "ANALYZE_CORE"`；
3. `src/background/analysis-service.ts` —— 调模型 → 逐句校验 → 最多两轮修复 → 写缓存；
4. `src/background/openai-compatible-adapter.ts` —— HTTP 细节、流式、三级能力降级；
5. `src/content/learning-block.ts` —— 卡片怎么替换原文、怎么还原。

两个值得先懂的设计约定：

- **缓存键与模型无关**：键 = 规范化句文本 + `CORE_SCHEMA_VERSION` + 提示词版本。所以换模型/换 Key，已解析过的句子直接命中缓存；改提示词必须升版本号，否则旧结果永远钉在缓存里。
- **流式分片不可信**：模型边吐的中间结果只用于"先渲染出来给你看"，不写缓存、不改句子状态；等完整响应校验通过才算数。

---

## 5. 本地测试

环境要求：**Node.js ≥ 22.20**（`node -v` 确认），包管理用 npm（仓库有 package-lock.json）。

```powershell
cd chrome-plugin
npm ci                 # 首次/拉代码后：按 lock 精确安装依赖
npm test               # 单测(Vitest)，1000+ 用例，约 15 秒
npx playwright test    # E2E：起假 OpenAI 服务器 + 真 Chrome 跑全链路，不联网不花 token
npm run lint           # ESLint
npm run build          # tsc 类型检查 + Vite 构建
```

要点与坑：

- **E2E 不需要 API Key**——`tests/support/fake-openai-server.ts` 会模拟模型端点；第一次跑 `npx playwright install` 装浏览器。
- **lint 恰好允许 1 个错误**（`src/options/options.test.ts` 的 `no-unnecessary-type-assertion`），这是仓库钉住的基线，**不要修它，也不要新增错误**。
- 本机若 `npm run format:check` 报一大片文件格式问题，多半是 Windows `autocrlf` 把文件检出了 CRLF（prettier 默认要 LF），属环境噪音；单查某个文件可用 `npx prettier --check --end-of-line auto <文件>`。
- 想盯某个文件写单测：`npm run test:watch`。
- 单测不跑真模型。要拿真模型做评测（黄金集评分脚本）是手动流程，见 `docs/architecture/build-test-release.md`。

---

## 6. 装到 Chrome 里跑起来

### 第一步：构建

```powershell
cd chrome-plugin
npm run build
```

产物在 `chrome-plugin/dist/`（含 manifest.json、service-worker、content-script、popup、options）。

### 第二步：以开发者模式加载

1. Chrome 地址栏输入 `chrome://extensions` 回车；
2. 右上角打开「**开发者模式**」；
3. 点「**加载已解压的扩展程序**」，选择 `chrome-plugin/dist` 目录；
4. 工具栏出现扩展图标即成功。改了代码后回到这个页面点该扩展卡片上的「**重新加载**」↻，再刷新目标网页。

> 也可以直接加载未构建的目录吗？不行——manifest 里写的是 TS 源文件路径，必须先 `npm run build` 产出 dist。

### 第三步：配置模型

1. 右键扩展图标 →「选项」（或扩展详情页 → 扩展程序选项）；
2. 填写：
   - **Base URL**：`https://api.deepseek.com`（DeepSeek 官方；本地 Ollama 填 `http://localhost:11434`，会被安全检查放行因为属于 localhost）
   - **Model**：`deepseek-chat`（便宜快）或 `deepseek-flash`（思考默认开，扩展会自动下发关闭思考的参数并按端点反应降级）
   - **API Key**：DeepSeek 后台申请的 Key
3. 点「**测试连接**」——它会发一个极简探测请求，自动探明端点是否支持 JSON Schema / 思考参数并持久化；
4. 保存时会请求**网站访问权限**（扩展默认只有 activeTab，访问哪个站就授权哪个站）。

### 第四步：用起来

- 打开任意英文网页（如 MDN、英文新闻），点扩展图标 → 开始会话；或把鼠标停在段落上按 **Alt+T** 解析当前段落；也可以选中文字右键解析；
- 段落被替换为拆解卡片，点任意成分看详解；
- popup 里可看进度、切模型 profile。

### 调试入口（对应你熟悉的"看日志"）

| 想看什么 | 去哪看 |
| --- | --- |
| 后台（service worker）日志 | `chrome://extensions` → 该扩展 → 「服务工作进程」蓝色链接，会弹出专属 DevTools |
| 页面侧（content script）日志 | 目标网页按 F12，Console 里选扩展的 context |
| 存储的 profile / 缓存 | 扩展专属 DevTools → Application → Storage（IndexedDB 库名 `english-syntax-learning-v1`） |
| 消息协议报错 | 任何一边的 Console，错误都带 `ERROR_CODES` 里的 code |

常见现象：后台 service worker 在空闲后被 Chrome 杀掉是 **MV3 正常行为**，有事件会自动唤醒，不是 bug。

---

## 7. 仓库里的另一端（IntelliJ 插件，一句话版）

`intellij-plugin/` 是同功能的 IDEA 插件：Kotlin + Gradle IntelliJ Platform，Markdown 预览页里用 JCEF 内嵌页面渲染同一套卡片，缓存用 SQLite（与 Chrome 的 IndexedDB 双向导入导出）。它有自己的门禁（仓库根跑 `./gradlew :intellij-plugin:test :intellij-plugin:buildPlugin`，子目录跑 npm）。**只有当改动波及 `shared-fixtures/`、桥协议或三处共享契约时才需要动它**——TS 与 Kotlin 双端各有独立实现，靠共享测试向量钉住行为一致。

---

## 8. 延伸阅读（按需）

| 想弄清 | 读 |
| --- | --- |
| 全局结构 / 模块职责 | `docs/architecture/overview.md`、`modules.md` |
| 消息协议全表 | `docs/architecture/protocol.md` |
| 模型调用/降级/缓存键 | `docs/architecture/model-pipeline.md` |
| 渲染与 DOM 替换 | `docs/architecture/rendering.md` |
| 踩过的坑（不变量清单） | `docs/architecture/invariants.md` |
| 门禁与发版流程 | `docs/architecture/build-test-release.md` |
| 仓库总约定（改代码前必读） | 根目录 `AGENTS.md` |
