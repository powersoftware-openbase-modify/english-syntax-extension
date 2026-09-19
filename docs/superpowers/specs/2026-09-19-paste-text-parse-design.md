# 粘贴课文解析 设计

日期：2026-09-19

## 目标

为没有 HTML 课文页的场景（智慧教育平台电子课本等文本层 PDF、老师发的 Word/文档）提供解析入口：用户把课文文本粘贴进扩展的独立页面，走现有 `ANALYZE_CORE` 全链路出三行拆解卡片。与网页解析共享同一份缓存与调度，**协议零新增消息**。

背景：目标用户为中小学生，官方电子课本（basic.smartedu.cn）已实测确认「PDF 文本层可拖选复制」（工具栏切 I 形选择工具），但平台页面本身是 PDF viewer / 课件图片流，DOM 扫描不可用——粘贴是绕开 PDF 渲染深坑的最短路径。

## 决策记录

| 问题 | 决策 |
| --- | --- |
| 入口位置 | popup 新增「粘贴课文解析」按钮，打开独立扩展页 `src/paste/paste.html`（popup 空间小且一关 JS 上下文即丢，长课文解析不能放 popup 里） |
| documentId | 粘贴页自造 `paste-<随机段>`；协议 `PageRequestBase(tabId+documentId)` 语义不变，trustedExtensionUi 已有 popup 先例 |
| 分句 | 粘贴文本按空行分段，每段走 `segmenter.ts` 的 `segmentBlock`，产 `SentenceInput`（与 content 同一套双端确定性分句） |
| 分批 | 按 `MAX_SENTENCES_PER_REQUEST`(6) 切批逐批发 `ANALYZE_CORE`；并发与优先级由 request-scheduler 照常接管 |
| 渲染 | 粘贴页自建只读卡片列表，三行结构与现有卡片对齐（新组件，不搬 learning-block——它深耦合 DOM 扫描/替换/视口观察） |
| 缓存 | 零改动：SW 的 ANALYZE_CORE 本就按「句文本+版本+prompt 版本」写缓存，粘贴结果网页命中、网页结果粘贴命中 |
| 进度 | 一期只等各批 `CORE_RESULT` 响应，页面显示「x/y 句」；不连 `CORE_STREAM` 端口（流式二期） |
| PDF 输入 | 粘贴页支持拖入/选择本地 PDF，用 pdfjs-dist 提取文本层重建段落，自动填入 textarea；不做 PDF 渲染视图与坐标高亮（决策见「PDF 拖入提取」节） |
| 详解点击 | 一期不做（见非目标） |

## 1. 页面与入口

- 新增 `src/paste/paste.html` + `paste.ts` + `paste.css`，注册进 `vite.config.ts` 的多页构建与 `manifest.json`（无需额外权限——扩展页发 runtime 消息天然可用）。
- `src/popup/popup.ts` 加入口按钮（`chrome.runtime.getURL("src/paste/paste.html")` 新标签打开），文案「粘贴课文解析」。
- 页面结构：大 textarea（粘贴区）＋「开始解析」按钮＋结果区（逐句卡片列表）＋顶部统计（x/y 句完成、失败数）。

## 2. 数据流

1. 「开始解析」：空行切段 → 逐段 `segmentBlock` → 汇总 `SentenceInput[]`（`sentenceId` 用 `p<段号>s<句号>`）；空结果给行内提示。
2. 按批切分后逐批发 `{ type: "ANALYZE_CORE", tabId, documentId: "paste-<uuid>", sentences }`（扩展页 sender，trusted）。
3. SW 照常：缓存查询 → 未命中句进 request-scheduler（`visible-core` 优先级）→ 模型 → 校验/修复 → 写缓存 → 回 `CORE_RESULT`（含逐句 `failures`）。
4. 粘贴页按 `sentenceId` 归位渲染：成功句出三行卡片，失败句出错误卡片（沿用 `INVALID_MODEL_OUTPUT：…` 文案与「重新解析」逻辑；一期重试 = 重发该句所在批，`bypassCache: true` 仅对该批）。
5. 再次点「开始解析」即全量重跑（命中缓存的句秒回）。

## 2.5 PDF 拖入提取（pdfjs-dist）

- **定位**：PDF 只作为「文本来源」接入粘贴管线，不做页内渲染/坐标对齐——渲染形态问题整个不存在，这也是与「不做 PDF 页内解析」原决策的兼容点。
- **依赖**：`pdfjs-dist`（Mozilla 官方，MIT）npm 引入随包分发——**MV3 禁远程代码，不可用 CDN**；worker 文件复制进构建产物，`GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs")`（扩展页加载自家资源无需额外权限）。
- **输入方式**：file input + 拖拽到粘贴区；**一期不做** URL 打开远程 PDF（跨域 + 智慧平台签名 URL 401，无收益）。
- **文本重建算法**（`src/paste/pdf-text.ts`）：
  1. `getTextContent()` 取带 transform 坐标的 text item；
  2. 按 y 坐标聚类成行（容差取字高的一半），行内按 x 排序拼接，相邻 item 间距判空格；
  3. 行距/缩进突变判段落边界；行尾连字符（`-`）与下一行首小写合并；
  4. 页与页拼接：页尾非句末标点则与下页首行合并（跨页段落）。
- **边界**：加密 PDF、无文本层（`getTextContent` 为空）→ 行内提示「此 PDF 没有文字层，请改用网页版课文」；一期只承诺单栏文档（课文/教辅），双栏渲染错序属已知限制记录在 CHANGELOG。
- 提取完成后文本进**同一个 textarea**，用户可检查修改后再解析——提取与解析解耦，算法瑕疵不直接变错卡片。

## 3. 协议与其它模块

- **协议零新增**：不新增消息类型/字段，`isRequestMessage`、`isRuntimeResponse`、SW 路由、`protocol.md` 全部不动——不触发三层校验同步。
- `manifest.json` 仅加页面注册；`web_accessible_resources` 不涉及。
- 模块地图：`modules.md` 增补 `src/paste/`；`overview.md` 的链路时序补「扩展页作为 ANALYZE_CORE 发起方」一条。

## 4. 实现前必验证（写实现计划时逐条确认）

- SW 的 `ANALYZE_CORE` 处理对 `activeTabs` 会话登记的依赖程度：粘贴页未登记会话时，取数/进度上报/`CACHE_HIT` 统计是否照常工作（预计需在 SW 给 `paste-` 前缀 documentId 走无页面分支，或粘贴页先自行登记——二选一在实现计划定）。
- `CORE_STREAM` 端口推送在无端口订阅时的容错（应天然跳过，确认即可）。
- `SESSION_STATUS` 上报路径对 `paste-` documentId 的兼容（不存在会话记录时不得抛错）。

## 5. 测试

- 单测（vitest，happy-dom）：
  - 粘贴页：分段/分句/切批的正确性与空输入容错；`CORE_RESULT` 成功/逐句失败两种归位渲染；重试批的 `bypassCache` 载荷。
  - SW：`ANALYZE_CORE` 来自扩展页 sender（`paste-` documentId）的端到端一次（fake chromeApi + fake 调度器），钉住「扩展页可作为发起方」。
  - `pdf-text`：小样本 PDF fixture（构建期生成或提交二进制）钉住聚行/拼段/连字符/跨页四条规则；无文本层 PDF 的提示路径。
- E2E（Playwright）：打开 `paste.html` → 填入 fixtures 课文文本 → 假 OpenAI 服务器响应 → 断言卡片三行结构逐句出现（探针断言，不用墙钟）；失败句显示错误文案。
- 门禁：`npm test && npx playwright test && npm run lint && npm run format:check && npm run build`；lint 保持恰好 1 个基线错误。

## 非目标（一期）

- 成分点击看详解（`ANALYZE_DETAIL` 链路可复用，二期连渲染面板一起做）。
- 流式渲染（`CORE_STREAM` 端口接入）。
- 生词本联动（等双击取词/生词本上线后，粘贴卡片接 ☆ 收藏）。
- OCR / 图片课文（智慧平台图片版教材先靠 HTML 课文站兜底）。
- 粘贴页内编辑句子后局部重析（重跑全量已够用）。
