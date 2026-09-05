# 准确性审计修复实施计划（批次 0-3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地审计报告批次 0-3 的全部修复（数据/钉子、validator 误杀修复、tokenization、漏判补门），提高句子成分划分准确性。

**Architecture:** 双端同步修改 Chrome TS 与 IntelliJ Kotlin 的 validator/segmenter/prompt + 黄金集与共享向量。批次顺序 0→1→2→3（本文件），批次 4-6 见续篇计划。每任务独立提交、独立过双端门禁。

**Tech Stack:** TypeScript + Vitest（chrome-plugin）、Kotlin + JUnit5 + Gradle（intellij-plugin）、shared-fixtures JSON 双端消费。

**Spec:** `docs/superpowers/specs/2026-09-04-accuracy-audit-fixes-design.md`（下称「规格」；条目以 G/V/S/P/R + 编号引用，内容详见规格 §2-§5）
**上游审计:** `docs/superpowers/audits/2026-09-04-accuracy-audit.md`（论证与行号证据）

## Global Constraints

- 双端逐字同步:validator 判定逻辑 + 英文错误文案、prompt 规则文本、词表成员——TS/Kotlin + contracts.json/parity fixture 一致（规格 §9.1）。
- **批次 1 与批次 3 的 validator 改动不升任何 PROMPT_VERSION**（规格 §3 结构性结论：repair prompt 是动态载荷不进缓存；旧缓存读回重过 validator，违背新门自动当 miss）。**批次 2 例外**——Task 10 的 tokenization 改动（etc. 变 Token ID）按 AGENTS 硬规则双升 CORE 11→12 / DETAIL 5→6（第 5 轮审核 A1 更正：原「批次 0-3 不升」为滑笔，D10 结论的作用域只有 validator 批次）。
- 黄金集 replay:每条新门/改门后整份 86 句过双端 validator（0d 起 Kotlin 侧可用；规格 §9.3）。
- lint 基线:恰好 1 个错误（options.test.ts 的 no-unnecessary-type-assertion），0 警告——不得新增（AGENTS 门禁）。
- 提交信息中文主题。
- 每批提交前 `npm run docs:drift`（chrome-plugin 内）。
- 门禁:chrome = `cd chrome-plugin && npm test && npx playwright test && npm run lint && npm run format:check && npm run build`;intellij = `(cd intellij-plugin && npm ci && npm test) && ./gradlew :intellij-plugin:test :intellij-plugin:buildPlugin :intellij-plugin:verifyPluginProjectConfiguration`（仓库根跑 gradle）。批次内小步提交可只跑相关测试,批次收尾必须跑全量门禁。
- 新黄金句不得早于批次 2 入库（规格 §9.9）。

---

## Task 1: 修 improved-008 标注 + of-钉住测试补 APPOSITIVE（0a / G1+G7）

**Files:**
- Modify: `chrome-plugin/tests/fixtures/core-gold-annotations.json`（improved-008 条目）
- Modify: `chrome-plugin/src/language/core-gold-annotations.test.ts:163-169`（nominalRoles）

**Interfaces:**
- Consumes: 现有 fixture 结构（sentences[].components[].startToken/endToken/role）
- Produces: 黄金集 86 句中 improved-008 的新标注；nominalRoles 含 APPOSITIVE（Task 4 的 Kotlin replay 与 Task 8+ 的黄金集 replay 依赖此数据）

- [ ] **Step 1: 改 nominalRoles 并跑测试确认变红（设计意图）**

`core-gold-annotations.test.ts` 的 `keeps every of-phrase out of the noun-phrase component it modifies` 测试中：

```ts
const nominalRoles: ReadonlySet<string> = new Set([
  GrammarRole.SUBJECT,
  GrammarRole.OBJECT,
  GrammarRole.PREDICATIVE,
  GrammarRole.COMPLEMENT,
  GrammarRole.ATTRIBUTE,
  GrammarRole.APPOSITIVE,
]);
```

Run: `cd chrome-plugin && npx vitest run src/language/core-gold-annotations.test.ts`
Expected: FAIL——`improved-008: APPOSITIVE 3-17 hides an of-phrase`（旧标注 APPOSITIVE 3..17 内含 of，indexOf ≥ 1）。

- [ ] **Step 2: 修 improved-008 标注**

fixture 中 improved-008（`The piezochiral effect, a new member of the family of strain-responsive functionalities alongside piezoelectricity and piezomagnetism, is introduced.`）的 components 改为（translation 字段保持原值不动的部分按区间对应调整，原 APPOSITIVE 3..17 的译文拆给新两个成分）：

```json
[
  { "startToken": 0, "endToken": 2, "role": "SUBJECT", "translation": "该压电手性效应" },
  { "startToken": 4, "endToken": 6, "role": "APPOSITIVE", "translation": "一个新成员" },
  { "startToken": 7, "endToken": 16, "role": "ATTRIBUTE", "translation": "应变响应功能家族中的" },
  { "startToken": 18, "endToken": 19, "role": "PREDICATE", "translation": "被介绍" }
]
```

（token 3、17 为逗号，退出覆盖。translation 具体措辞可按原 fixture 风格微调，区间必须精确如上。）

- [ ] **Step 3: 跑黄金集全套测试确认绿**

Run: `cd chrome-plugin && npx vitest run src/language/core-gold-annotations.test.ts`
Expected: PASS（含 `passes the production core validator sentence by sentence` 的整份 replay——新标注过全部 13 门）。

- [ ] **Step 4: Commit**

```bash
git add chrome-plugin/tests/fixtures/core-gold-annotations.json chrome-plugin/src/language/core-gold-annotations.test.ts
git commit -m "test: 修正 improved-008 黄金标注并封住 APPOSITIVE 藏 of 短语缺口"
```

---

## Task 2: 补 Kotlin 死测试 @Test + 词表元测试（0b / V4）

**Files:**
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt`（:191 与 :375 两处 fun 前补 `@Test`；文件末追加元测试）
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`（6 张词表 `private` → `internal`）

**Interfaces:**
- Consumes: AnalysisValidator.kt 现有 6 张字符串词表
- Produces: `internal` 可见词表 + `AnalysisValidatorTest` 中的 `word list sizes stay pinned` 元测试（Task 13/14/22 增量登记依赖此测试存在——第 5 轮审核 B1 更正：原引 Task 8/9/12 有误）

- [ ] **Step 1: 补两个 @Test 注解**

在 `rejects a CONJUNCTION that covers no coordinating conjunction`（约 :191）与 `rejects one component covering the whole sentence whatever its role`（约 :375）两个 fun 前各加一行 `@Test`（含上下空行格式与邻近用例一致）。

- [ ] **Step 2: 词表 private → internal**

`AnalysisValidator.kt` 六处声明改可见性（名称不变）: `coordinatingConjunctions`(:86)、`prepositions`(:95)、`subjectPronouns`(:111)、`determiners`(:120)、`subordinatingConjunctions`(:132)、`objectRequiringPrepositions`(:193)，`private val` → `internal val`。文件头注释补一句「词表 internal 供测试数成员，判定逻辑不变」。

- [ ] **Step 3: 写元测试**

AnalysisValidatorTest.kt 末尾追加：

```kotlin
@Test
fun `word list sizes stay pinned`() {
  assertEquals(7, coordinatingConjunctions.size)
  assertEquals(15, prepositions.size)
  assertEquals(7, subjectPronouns.size)
  assertEquals(13, determiners.size)
  assertEquals(21, subordinatingConjunctions.size)
  assertEquals(11, objectRequiringPrepositions.size)
}
```

（internal 顶层声明对同包测试类直接可见、无需 import——已有活先例:`repairTruncatedJson`、`injectForTest()` 均为 internal 且被测试调用;若声明在 object 内则用对象限定名。）

> 元测试守护边界（第 2 轮审核 G1）:钉的是 Kotlin 侧成员数（防静默增删）,防不了换词;TS 侧无对称元测试（词表不导出）——TS↔Kotlin 词表漂移由黄金集双端 replay 与 contract 测试间接兜底。**加词须双端同步 + 同步改此断言**（后续任务已有登记步骤）。

- [ ] **Step 4: 跑 Kotlin validator 测试**

Run: `./gradlew :intellij-plugin:test --tests "dev.codetui.englishsyntax.language.AnalysisValidatorTest"`
Expected: PASS（**45 个用例**全绿——现有 42 个 @Test + 两个复活 + 一个元测试）。

- [ ] **Step 5: Commit**

```bash
git add intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt
git commit -m "test: 复活 Kotlin 校验器死测试并钉住词表成员数"
```

---

## Task 2b: validator 错误文案 shared fixture（第 3 轮审核 B1:双端互验机制缺口的收口）

**Files:**
- Create: `shared-fixtures/validator-messages.json`
- Modify: `chrome-plugin/src/language/analysis-validator.ts`（可选:导出一个固定输入 → 全部文案的纯函数,或由测试组装）
- Create/Modify: `chrome-plugin/src/language/validator-messages.test.ts`（TS 消费端）
- Create/Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/ValidatorMessagesTest.kt`（Kotlin 消费端）

**Interfaces:**
- Consumes: 双端 validator 对固定 synthetic 输入产出的 errors 数组
- Produces: `shared-fixtures/validator-messages.json`——**顶层对象** `{ coveredMessageSubstrings: string[], cases: [{id, input: {sentence, components-json}, expected: [{path, message}]}] }`（第 5 轮审核 A3 统一：原 Produces 写纯数组挂不了顶层字段）;后续 Task 7/13/14/22 的新门文案各增补条目（各自任务 Files 已含此文件）

- [ ] **Step 1: 定义固定输入集（覆盖现 13 门各至少一条;**排除已知分叉项**）**

每门选一个最小触发输入（句子 + components JSON 字符串）——**批次 0 实际可钉的是「10 门 + 助动词子门与负数文案等已对齐子项」,排除三条门后初建覆盖即它们暂无条目**（第 5 轮审核 A3 措辞更正:「13 门各至少一条」与排除并存时字面不可满足,以 coveredMessageSubstrings 清单自声明的实际内容为准）。**批次 0 输入集必须排除三类已知双端分叉的输入**（第 4 轮审核 D-2——它们正是后续任务要修的,现在钉进夹具会当场红、无法满足 Step 3「双端绿」）:①纯标点成分输入（V8,TS 报结构错/Kotlin 预丢弃,Task 8 落地时补入）;②前谓语为单词助动词的相邻 PREDICATE 输入（V9,文案分叉,Task 22 落地时补入）;③负数/`"0.0"` startToken 输入（V11,Kotlin 专属文案,Task 25 落地时补入）。

- [ ] **Step 2: TS 生成 fixture（唯一生成端），双端消费 + 覆盖表断言**

TS 侧把「输入 → 完整 errors 数组」写入 fixture（多门命中同一输入时 expected 含多条,合法）;TS 测试断言 `validateCoreBatch(输入) 的 errors === fixture 条目`;Kotlin ValidatorMessagesTest 同款断言（**纯消费**）。此后任何单端改文案都会在另一端红。**覆盖表机器断言（第 4 轮审核补）**:TS 测试加一条「fixture 全体 errors 消息的并集 ⊇ 各门代表文案子串清单」断言,防后续任务增删条目时漏门——清单本身进 fixture 的 `coveredMessageSubstrings` 字段。

- [ ] **Step 3: 双端测试绿 + Commit**

```bash
git add -A
git commit -m "test: 校验器错误文案建立双端互验夹具"
```

---

## Task 3: 补共享分句向量（0c / S7）

**Files:**
- Modify: `shared-fixtures/segmenter-vectors.json`（追加向量组）
- Test: 双端 segmenter 测试自动消费（TS `it.each(vectors)` / Kotlin for 循环遍历）

**Interfaces:**
- Consumes: 现有向量 JSON 结构（实测 schema 为 `{name, block, sentences: [{text, start, end, tokens: [...]}]}`——字段名是 **block** 非 input）
- Produces: 新增 5 组向量，双端同测

- [ ] **Step 1: 确认向量 schema**

读 `shared-fixtures/segmenter-vectors.json` 前 2 组，按既有结构构造新向量（字段名、expected sentences/tokens 的表达方式照抄）。

- [ ] **Step 2: 追加 5 组向量（期望值按当前实现行为写——本任务是钉住现状，不是改行为）**

1. `url-at-sentence-end`: input `Read https://example.com/docs. Then run it.` → 两句 `Read https://example.com/docs.` / `Then run it.`；URL 单 token 不含句点。
2. `email-at-sentence-end`: input `Contact ada@example.com. Thanks.` → 两句；邮箱单 token。
3. `question-exclaim-quote`: input `Really?!" She asked.` → 两句 `Really?!"` / `She asked.`
4. `decimal-sentence-end`: input `The value is 4.5.` → 一句；`4.5` 单 token + 句点独立 token。
5. `please-stop`: input `Please stop. We need to talk.` → 两句（钉住 `p.` 不误配 `Please`）。

**注意**:若 Step 2 某组实测行为与上述期望不符（如 URL 吞句点），**以实测为准写向量并停下报告**——那意味着审计对该行为的判断有误，需回规格确认而不是硬写错误期望。

- [ ] **Step 3: 双端跑 segmenter 测试**

Run: `cd chrome-plugin && npx vitest run src/language/segmenter.test.ts`；`./gradlew :intellij-plugin:test --tests "dev.codetui.englishsyntax.language.SegmenterTest"`
Expected: 双端 PASS。

- [ ] **Step 4: Commit**

```bash
git add shared-fixtures/segmenter-vectors.json
git commit -m "test: 补句尾 URL 邮箱连用标点与小数收句共享向量"
```

---

## Task 4: 黄金集搬入 shared-fixtures 双端消费（0d / V10）

**Files:**
- Move: `chrome-plugin/tests/fixtures/core-gold-annotations.json` → `shared-fixtures/core-gold-annotations.json`
- Modify: `chrome-plugin/src/language/core-gold-annotations.test.ts`（import 路径）
- Modify: `chrome-plugin/package.json`（test:contracts 脚本追加该测试文件）
- Create: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/contract/CoreGoldAnnotationsTest.kt`
- Modify: `docs/architecture/modules.md:129`、`docs/architecture/build-test-release.md:73`（旧路径）
- Modify: `.superpowers/acceptance/run-core-gold-evaluation.mjs:21`（gitignored 本地脚本）

**Interfaces:**
- Consumes: Task 1 修正后的黄金集；FixtureLoader.text()（读 shared-fixtures）
- Produces: 双端黄金集 replay 能力（Task 5-9 的 Kotlin 侧 replay 依赖）；`CoreGoldAnnotationsTest` 逐句过 `validateCoreBatch`

- [ ] **Step 1: 移动文件 + 改 TS 路径 + 登记 contracts**

`git mv chrome-plugin/tests/fixtures/core-gold-annotations.json shared-fixtures/core-gold-annotations.json`；TS 测试 import 改为相对 `../../../shared-fixtures/core-gold-annotations.json`（参照 cross-platform-contract.test.ts 的写法）；package.json `test:contracts` 脚本末尾追加 ` src/language/core-gold-annotations.test.ts`。

- [ ] **Step 2: TS 侧验证**

Run: `cd chrome-plugin && npm test && npm run test:contracts`
Expected: PASS。

- [ ] **Step 3: 写 Kotlin 逐句 replay 测试**

```kotlin
package dev.codetui.englishsyntax.contract

// 顶层函数直接 import（无 Segmenter 类）:
import dev.codetui.englishsyntax.language.tokenize
// 按仓库既有 JSON 解析模式（LenientJson/JsonObject,参照 SharedContractTest 消费 contracts.json 的方式）解析 fixture;
// 结构: { conventions: [...], sentences: [{ id, text, components: [{startToken,endToken,role}] }] }
// validateCoreBatch 签名: (raw: JsonElement, requests: List<SentenceInput>, profileId: String) —— 只收 JsonElement,
// raw 组装参照 AnalysisValidatorTest 既有 core() helper(逐成分 JSON 数组字符串)

class CoreGoldAnnotationsTest {
  // 逐句: tokenize(text) → core() 式 raw JSON(translation 用"译文") → validateCoreBatch(raw, listOf(单句请求), "gold") 断言 ok
}
```

实现要点:黄金集 JSON 无 translation 字段，逐句注入占位非空译文 `"译文"`（TS 侧测试 :201-204 同款做法——**勿用空串**,双端 validator 对空 translation 报 must not be empty,86 句会全红）；用 `FixtureLoader.text("core-gold-annotations.json")` 读取。

- [ ] **Step 4: 跑 Kotlin 测试**

Run: `./gradlew :intellij-plugin:test --tests "dev.codetui.englishsyntax.contract.CoreGoldAnnotationsTest"`
Expected: PASS（86 句全过 Kotlin 13 门）。

- [ ] **Step 5: 改 3 处文档路径 + acceptance 脚本路径**

modules.md:129 与 build-test-release.md:73 的 `tests/fixtures/core-gold-annotations.json` 改为 `shared-fixtures/core-gold-annotations.json`；`.superpowers/acceptance/run-core-gold-evaluation.mjs` :21 同改。

- [ ] **Step 6: 全量门禁 + Commit**

Run: 双端全量门禁（Global Constraints 第 7 条）。
```bash
git add -A
git commit -m "test: 黄金集升入 shared-fixtures 实现双端校验回归"
```

---

## Task 0E: 生产链路评测接入与行为改动前基线（Task 4 后、Task 5 前）

**Files:**
- Modify: `.superpowers/acceptance/run-core-gold-evaluation.mjs`（手动联网入口，gitignored，永不提交）
- Modify: `chrome-plugin/scripts/core-evaluation.mjs`、`chrome-plugin/scripts/core-evaluation.test.mjs`（轨迹评分、字符区间比较、同句集报告）
- Modify: `chrome-plugin/src/background/analysis-service.test.ts`（真实 service 固定响应轨迹）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/analysis/AnalysisServiceTest.kt`（同轨迹回放）
- Create: `shared-fixtures/core-evaluation-traces.json`（脱敏固定响应，仅离线测试）
- Modify: `docs/architecture/build-test-release.md`（首轮评分与最终链路验收的边界）

**Interfaces:** Consumes: CachedAnalysisService、AnalysisAdapter.completeJson、CoreBatchInput.bypassCache 与现有纯评分器。Produces: 同次请求的首轮/各轮修复/最终结果轨迹、规范化字符 span 评分、固定语料快照；实施与验收严格遵循规格 §9.1。不复制生产 validator 或 repair 循环。

- [ ] **Step 1: 冻结评测文本与人工标注依据**。分规则回归集与独立留出集（五类各至少 4 句）；批次 2 前新句仅存 acceptance 文本/词语边界快照，不提前入共享黄金集。记录来源、类别、标注理由；独立留出句不进入 prompt。将 Task 21 已确认的两处黄金纠错纳入评测口径快照，避免基线奖励已知错标；正式 fixture 仍按原批次修改。
- [ ] **Step 2: 写离线失败测试**。固定轨迹覆盖：首轮合法不 repair；首轮错误→修对；语法 exact 但非语法字段错误被拒→修坏；三轮错误→最终失败；两句中一修好不回流。断言 `repairedToCorrect`、`correctToWrongOrFailure`、`finalFailures` 的计数及固定全集分母，正确首轮数为零时拒绝率为 N/A。分别构造相同字符边界但 token ID 不同的结果，断言跨 tokenizer 比较相等。先运行 `node --test chrome-plugin/scripts/core-evaluation.test.mjs` 与 `cd chrome-plugin && npx vitest run src/background/analysis-service.test.ts`，确认因缺少轨迹评分能力而失败。
- [ ] **Step 3: 接入实际服务**。acceptance 脚本经 Vite 加载 CachedAnalysisService；复用 service 单测的内存 cache/scheduler 装配，cache 初始为空，输入 `bypassCache: true`。包装 AnalysisAdapter 记录 messages、返回 JSON、调用顺序；按 schema 转发实际模型请求，不手写另一套修复流程。通过 `analyzeCore` 返回的最终结果评分；第一轮 JSON 同时独立评分并用生产 validator 诊断拒绝原因。真实路径中包含 repair，首轮与最终必须来自同一次服务调用。
- [ ] **Step 4: 双端离线回放与元数据**。将合成脱敏轨迹写入共享 fixture；TS/Kotlin 各经本端 AnalysisService 回放并断言相同最终 span/role、成功失败句集合及 repair 子集。本地真模型轨迹不自动提交。artifact 按规格 §9.1 保存模型参数、批大小/顺序、commit、prompt/语料/tokenizer 快照及哈希，不保存密钥。增加 `--mode pipeline`（保留默认首轮模式），第一份基线明确传 `--candidate` 指向独立文件，后续 `--baseline` 只读，禁止覆盖基线。
- [ ] **Step 5: 验证并留基线**。跑评分器相关测试、TS AnalysisService 测试及 Kotlin AnalysisServiceTest，全部离线。手动运行 `source ~/.secrets && node .superpowers/acceptance/run-core-gold-evaluation.mjs --mode pipeline --candidate .superpowers/acceptance/core-pipeline-baseline-run1.json`；以 run2/run3 不同文件名再运行两次，固定配置与顺序。无 key 时冻结快照并登记“准确性验收待完成”，未来从旧 commit 补跑；不以新实现冒充旧基线。提交只包含离线工具/测试/共享 fixture/文档，不包含 acceptance 文件。

---

## Task 5: V1 尾介词角色豁免（1a）

**Files:**
- Modify: `chrome-plugin/src/language/analysis-validator.ts`（尾介词门 :385-398）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`（:301-312）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt`

- Modify: `shared-fixtures/validator-messages.json`（第 4 轮审核:判定变化——夹具若含「PREDICATIVE_CLAUSE 尾 of」类输入,从拒变过,该条目删除或换为短语角色反例,双端同提交）

**Interfaces:**
- Consumes: `CLAUSE_ROLES` 集合（TS :188-194 / Kotlin :150 附近）
- Produces: 尾介词门对从句角色的豁免（`of/within/between/among` 保留白名单；词表成员数不变，Task 2 元测试不受影响）

- [ ] **Step 1: 写失败测试（双端）**

TS analysis-validator.test.ts 追加：

```ts
it("accepts a clause that legally ends on a dangling of/within/between/among", () => {
  // "That's what dreams are made of." 
  // PREDICATIVE_CLAUSE 覆盖 "what dreams are made of"(尾词 of) → 须过
  // 组装方式参照既有 "accepts a relative clause..." 用例(sentence() helper)
});
it("still rejects a phrase component ending on of with its object split off", () => {
  // "The tool works near the frontier of what AI can do." 若模型把 ADVERBIAL 标成 
  // "near the frontier of" + OBJECT_CLAUSE "what AI can do" → ADVERBIAL 尾 of 仍须拒
});
```

Kotlin AnalysisValidatorTest.kt 追加同款两个用例（用既有 `sentence()` / `core()` helper）。**TS 侧用例 2 也须断言同款文案**（复用既有 `DANGLING_PREPOSITION_MESSAGE` 常量,analysis-validator.test.ts:682-683）——双端守护强度一致,文案即修复指令。

- [ ] **Step 2: 跑测试确认失败模式正确**

Run: 双端 validator 测试。
Expected: 新用例 1 FAIL（现状 PREDICATIVE_CLAUSE 尾 of 被拒）；用例 2 PASS（现状已拒）。

- [ ] **Step 3: 双端实现角色豁免**

TS :385-398 的判定加一个条件:

```ts
if (
  component.role !== GrammarRole.CONJUNCTION &&
  !CLAUSE_ROLES.has(component.role) &&   // 新增:从句角色的介词悬垂合法
  words.length > 1 &&
  tail !== undefined &&
  OBJECT_REQUIRING_PREPOSITIONS.has(tail)
) {
```

注释补:「of/within/between/among 在关系从句/名词性从句内部可合法悬垂(`That's what dreams are made of.`);短语角色照旧拦(`near the frontier of` + 宾语从句被外切)」。
Kotlin :301-312 同步:`component.role !in clauseRoles &&`。

- [ ] **Step 4: 双端跑测试 + 黄金集双端 replay**

Run: 双端 validator 测试 + Task 4 的 CoreGoldAnnotationsTest + TS 黄金集测试。
Expected: 全 PASS（黄金集无句尾 of 成分，replay 安全——审计已实测）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: 尾介词门对从句角色豁免悬垂介词"
```

---

## Task 6: V3 跟随门移出 COMPLEMENT（1b）

**Files:**
- Modify: `chrome-plugin/src/language/analysis-validator.ts`（CLAUSE_INTERNAL_FOLLOWERS :219-223 + 门 :375-383）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`（clauseInternalFollowers :178-182 附近 + 门）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt`

- Modify: `shared-fixtures/validator-messages.json`（第 4 轮审核:判定变化——夹具若含「ATTRIBUTIVE_CLAUSE+COMPLEMENT」输入,从拒变过,条目同步,双端同提交）

**Interfaces:**
- Consumes: CLAUSE_INTERNAL_FOLLOWERS 集合
- Produces: 集合缩为 {OBJECT, PREDICATIVE}（成员数 3→2；若 Task 2 元测试纳入该集合需同步改断言——本计划未纳入，只需改集合）

- [ ] **Step 1: 写失败测试（双端）**

用例:`We consider the movie that she directed a masterpiece.` → SUBJECT(We) PREDICATE(consider) OBJECT(the movie) ATTRIBUTIVE_CLAUSE(that she directed) COMPLEMENT(a masterpiece) → 须过（现状被拒）。
断言方式参照既有 `rejects an ATTRIBUTIVE_CLAUSE followed immediately by the object it should contain`（改为 accept + 无该错误）。

- [ ] **Step 2: 跑测试确认失败**

Expected: 新用例 FAIL（现状 COMPLEMENT 在跟随集内被拒）。

- [ ] **Step 3: 双端实现**

TS :219-223 删除 `GrammarRole.COMPLEMENT,`；Kotlin clauseInternalFollowers 同步删 `GrammarRole.COMPLEMENT`。注释补:「宾补结构 `consider the movie that she directed a masterpiece` 的补语跟在宾语定从之后合法;双宾 `give the teacher who helped me a book` 残留误杀接受(低频)」。

- [ ] **Step 4: 双端测试 + 黄金集双端 replay**

Expected: 全 PASS（黄金集 ATTRIBUTIVE_CLAUSE 后随仅 PREDICATE×3/ADVERBIAL×1，无 COMPLEMENT——审计实测 replay 安全）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: 定语从句跟随门不再误杀宾补结构"
```

---

## Task 7: V2+V12 统一整句门（1c）

**Files:**
- Modify: `chrome-plugin/src/language/analysis-validator.ts`（整句门 :401-415 + 常量区）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts`
- Modify: `chrome-plugin/src/shared/architecture-docs.test.ts`（钉上限常量）
- Modify: `docs/architecture/model-pipeline.md` 与 `docs/architecture/invariants.md`（**须同步写出常量值 10**——expectDocumentedNumber 要求文档里出现该数值,否则断言红;勿等 Task 15 统一补）
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`（:315-329）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt`

- Modify: `shared-fixtures/validator-messages.json`（Task 2b 夹具增补本门新文案条目;**旧整句门条目可能失效**——若夹具含「INDEPENDENT_ELEMENT/APPOSITIVE 整句」输入,旧门只豁免 FRAGMENT_HEAD 现状被拒,本任务后 ≤10 实词变 ok,该条目 expected 同步改;**新文案子串同步进 coveredMessageSubstrings**,双端同提交）

**Interfaces:**
- Consumes: Task 1 落地后的黄金集与 Task 0E 冻结的挑战文本；10 为已裁定启发式值，不以多成分句中的 ATTRIBUTE 长度证明阈值正确。
- Produces: `MAX_WHOLE_SENTENCE_FRAGMENT_LEXICAL_TOKENS = 10` 常量（双端同名）+ 豁免集 {FRAGMENT_HEAD, INDEPENDENT_ELEMENT, APPOSITIVE}

- [ ] **Step 0: 先做长度门挑战审阅，禁止跳过**。从真实文档标题、名词片段、形容词片段各选 9/10/11+ 实词样本（记录来源），人工判断是否存在按本项目口径可拆的后置修饰语，生产 tokenizer 实测长度。补短完整句 `The system works correctly.` 整体误标 FRAGMENT_HEAD 的漏判探针。若存在合法且不可再拆的 11+ 词片段，记录该门误杀并暂停行为实现，请用户复核阈值裁定；不得将错误拆分当预期结果。该探针不要求添加词表识别限定谓语。

- [ ] **Step 1: 写失败测试（双端，三组；仅 Step 0 无阻断后）**

1. 11 实词整句单 FRAGMENT_HEAD → 拒,期望文案是**新门文案** `a whole-sentence fragment component must not exceed 10 lexical tokens; split it into a fragment head plus its modifiers`（**勿写旧整句门文案**——FRAGMENT_HEAD 在豁免集内,旧门被跳过,断旧文案实现后仍红）。例句自造 11+ 实词成句（`The quick brown fox jumps over the lazy dog near the river bank.`——实测 **13** 实词）整句标一个 FRAGMENT_HEAD。
2. `What a wonderful surprise!`（4 实词）整句 INDEPENDENT_ELEMENT → 过（现状被拒）。
3. 9-10 实词无可拆后置修饰语的独立标题，推荐标注 FRAGMENT_HEAD → 过；另用同一输入整体 APPOSITIVE → 过，仅钉已裁定的**容错接收**，不得写入黄金答案或称为语言学正例。候选 `A fast, reliable, secure, and modern developer experience platform`（9 实词，实施时核 tokenizer）；10 词样本从 Step 0 人工审阅集取。不要用 `Claude Code, a ... platform` 整体 APPOSITIVE 冒充正例，该结构含显式同位对象，推荐分别标片段主体与同位语。

- [ ] **Step 2: 跑测试确认失败模式**

Expected: 用例 1 FAIL（期望拒绝而现状通过）；用例 2 FAIL；用例 3 的 APPOSITIVE 容错断言 FAIL，FRAGMENT_HEAD 推荐标注断言 PASS。不要把“错误输出通过 validator”误写成“拒绝断言 PASS”。

- [ ] **Step 3: 双端实现**

TS :401-415 改:

```ts
const WHOLE_SENTENCE_FRAGMENT_ROLES: ReadonlySet<GrammarRole> = new Set([
  GrammarRole.FRAGMENT_HEAD,
  GrammarRole.INDEPENDENT_ELEMENT,
  GrammarRole.APPOSITIVE,
]);
const MAX_WHOLE_SENTENCE_FRAGMENT_LEXICAL_TOKENS = 10;
// 单成分整句的豁免集:三角色均为「片段语义角色」;配实词上限防整句糊弄。
// 10 是经挑战集审阅后采用的启发式上限，不是语法定律；不能据此证明长片段可拆。

if (
  only !== undefined &&
  !WHOLE_SENTENCE_FRAGMENT_ROLES.has(only.role) &&
  lexicalTokenCount >= MIN_SPLITTABLE_LEXICAL_TOKENS &&
  lexicalTexts(tokens, only).length === lexicalTokenCount
) {
  // 原错误文案不变
}
// 新增第二段:豁免角色但超上限
if (
  only !== undefined &&
  WHOLE_SENTENCE_FRAGMENT_ROLES.has(only.role) &&
  lexicalTexts(tokens, only).length > MAX_WHOLE_SENTENCE_FRAGMENT_LEXICAL_TOKENS &&
  lexicalTexts(tokens, only).length === lexicalTokenCount
) {
  addError(errors, `${path}.components`,
    `a whole-sentence fragment component must not exceed ${MAX_WHOLE_SENTENCE_FRAGMENT_LEXICAL_TOKENS} lexical tokens; split it into a fragment head plus its modifiers`); // 文案用常量插值,上限调整只改一处
}
```

Kotlin :315-329 同构实现（常量同名 `MAX_WHOLE_SENTENCE_FRAGMENT_LEXICAL_TOKENS`;**文案用 Kotlin 字符串模板** `"a whole-sentence fragment component must not exceed $MAX_WHOLE_SENTENCE_FRAGMENT_LEXICAL_TOKENS lexical tokens; split it into a fragment head plus its modifiers"`——单串+$插值,勿按文件内既有 `+` 拼接风格写死 10,否则常量改值时 TS 改 Kotlin 漏,静默分叉）。

- [ ] **Step 4: architecture-docs 断言 + 双端测试 + replay**

`architecture-docs.test.ts` 按 `expectDocumentedNumber` 既有模式钉 `MAX_WHOLE_SENTENCE_FRAGMENT_LEXICAL_TOKENS = 10`（用 `literalNumber(sourceOf(...))` 读源码——参照该文件 :39-43 的 helper 用法）。
Run: 双端 validator 测试 + 黄金集双端 replay（**关键**:0a 落地后 improved-008 的 10 实词 ATTRIBUTE 不是单成分整句(4 成分),不触本门;`fragment-compatible-providers` 单成分 FRAGMENT_HEAD 6 实词 ≤10 过）。
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: 单成分整句豁免集配实词上限防糊弄"
```

---

## Task 8: V8 纯标点预丢弃下沉 validator（1d）

**Files:**
- Modify: `chrome-plugin/src/language/analysis-validator.ts`（parse 阶段预丢弃纯标点成分）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts`（改既有纯标点反例断言）
- Modify: `chrome-plugin/src/background/analysis-service.ts`（删 dropPunctuationOnlyComponents 调用,函数可留或删）
- Verify-only: `chrome-plugin/src/background/analysis-service.test.ts` 的三个纯标点用例（:1290-1343,断言 service 层 drop 行为）——drop 下沉后行为等价应保持绿,**确认等价、预期不改**;若 fetch 计数断言意外红再评估
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`（:414-424 已有预过滤,补「整句全纯标点」文案与 TS 对齐）

- Modify: `shared-fixtures/validator-messages.json`（第 4 轮审核:TS 纯标点文案口径变化——Task 2b 排除的纯标点输入此时**补入夹具**（双端已对齐）,含「丢弃后通过」与「整句全纯标点拒」两类条目,双端同提交）

**Interfaces:**
- Consumes: Kotlin 现有预过滤语义（:414-424）+ 文案 `must contain a non-punctuation component`
- Produces: 双端统一的「预丢弃」语义;correction 路径（analysis-service.ts :992/:1010 直调 validateCoreBatch）自动闭合

- [ ] **Step 1: 改 TS 既有反例断言（红）**

`a punctuation-only component` 用例改为断言「被丢弃后通过」:输入含一个纯标点成分 + 正常成分 → `result.ok === true` 且 components 数组不含纯标点成分;另加「整句全纯标点」用例断言拒 + 文案 `must contain a non-punctuation component`。

- [ ] **Step 2: TS 实现预丢弃**

在 components 解析**前**按原始数组先 filterNot 纯标点再 mapIndexed 编 path（**与 Kotlin :414-427 现状同口径**——Kotlin 是先过滤再编号;若 TS 在映射后过滤,parse 错误的 path 索引会与 Kotlin 分叉,混合错误场景的 repair prompt 双端不一致）;若丢弃后 semanticComponents 为空 → addError(`must contain a non-punctuation component`)。删 :597-600 的旧纯标点结构错误。analysis-service.ts 的 `dropPunctuationOnlyComponents` 调用点删除（函数本体删除）。

- [ ] **Step 3: Kotlin 对齐**

Kotlin :414-424 已预丢弃且索引口径即目标口径;**Kotlin validateCoreBatch :492-494 的成功后二次过滤保留不动**（防御性,与预过滤条件差异不影响 errors 输出;TS 侧**不**实现对应物——双端口径就此写死,勿「顺手同构」）;确认「整句全纯标点」文案与 TS 逐字一致（`must contain a non-punctuation component`——已核 :422 现有文案即此）。Kotlin 侧两个「丢弃后通过」用例（AnalysisValidatorTest.kt:540/:557）钉的正是目标行为,**保持不动**。

- [ ] **Step 4: 双端测试 + replay + E2E**

Run: 双端 validator 测试 + 黄金集双端 replay + `cd chrome-plugin && npx vitest run src/background/analysis-service.test.ts`（correction 路径相关用例）。
Expected: 全 PASS。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "fix: 纯标点成分预丢弃下沉进双端校验器"
```

---

## Task 9: 批次 1 收尾门禁

- [ ] **Step 1: 全量双端门禁**

Run: Global Constraints 第 7 条全量命令。
Expected: chrome 928+ 测试全绿 + playwright 全绿 + lint 恰 1 错;intellij npm + gradle 全绿。

- [ ] **Step 2: `cd chrome-plugin && npm run docs:drift`**

Expected: 按 Task 4-8 改动文件提示的文档已同步;无缺失。

---

## Task 10: S1 etc. 进两张表（2a）

**Files:**
- Modify: `chrome-plugin/src/language/segmenter.ts`（ABBREVIATIONS :42-86 + CONTEXT_SENSITIVE :91）
- Modify: `chrome-plugin/src/language/segmenter.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/Segmenter.kt`（:10-17 ABBREVIATIONS + :38 CONTEXT_SENSITIVE）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/SegmenterTest.kt`
- Modify: `shared-fixtures/segmenter-vectors.json`（etc. 两态向量）
- Modify: 版本四文件——`chrome-plugin/src/shared/versions.ts`、`intellij-plugin/.../domain/Domain.kt`、`shared-fixtures/contracts.json`、`shared-fixtures/core-prompt-parity.json`（版本字段 11→12、5→6）
- Modify: `chrome-plugin/src/shared/cross-platform-contract.test.ts` 与 Kotlin `SharedContractTest.kt` 中版本断言（若有硬编码）
- Modify: `AGENTS.md:45/:48`、`docs/architecture/invariants.md:131`、`docs/architecture/overview.md:105/195`（缩写枚举 + 版本号）

**Interfaces:**
- Consumes: 双端缩写表结构
- Produces: `etc.` 单 token（punctuation=false）;CORE_PROMPT_VERSION=12、DETAIL_PROMPT_VERSION=6（Task 11+ 的 parity/版本断言依赖）

- [ ] **Step 1: 写失败测试（双端）**

TS segmenter.test.ts:
```ts
it("keeps etc. attached in mid-sentence and splits before a capital continuation", () => {
  expect(segmentBlock("Use counters, timers, etc. in practice.")[0]?.text) // 一句含 etc.
  // "We tried tools, etc. Then we gave up." → 两句; etc. 单 token
});
```
Kotlin 同款。token 断言:tokenize("etc. in practice") 中 `etc.` 是单 token 且 punctuation=false。

- [ ] **Step 2: 确认失败**

Expected: FAIL（现状 `etc.` 缺席 → 句中切残句）。

- [ ] **Step 3: 双端加表**

TS ABBREVIATIONS 数组按字母序合适位置（`e.g.` 附近）插 `"etc.",`;CONTEXT_SENSITIVE_ABBREVIATIONS 数组（现 6 词）追加 `"etc.",`。**双端插入位置保持同序**。Kotlin :10-17 与 :38 同步。注释 :37 顺手修正（etc. 已进表）。

- [ ] **Step 4: 版本四文件同升 + 向量**

versions.ts `CORE_PROMPT_VERSION = 12`、`DETAIL_PROMPT_VERSION = 6`;Domain.kt 同;contracts.json 两字段;core-prompt-parity.json 的 `corePromptVersion` 字段 bump（**prompt 文本不动**）。segmenter-vectors.json 追加两组:
- `etc-mid-sentence`: `Use counters, timers, etc. in practice.` → 一句
- `etc-sentence-end-capital`: `We tried tools, etc. Then we gave up.` → 两句

- [ ] **Step 5: 文档同步**

AGENTS.md:45 可收句类枚举加 `etc.`（注明属可收句类）;AGENTS.md:48 版本号 core 11→12（含一句「版本 12 引入 etc. token 化」）、detail 5→6;invariants.md:131 与 overview.md:105/195 同步枚举。检查 cross-platform-contract.test.ts / SharedContractTest.kt 的版本断言是否硬编码（应从 fixture 读,若有硬编码同步改）。

- [ ] **Step 6: 双端全量门禁 + Commit**

Run: 全量门禁（playwright 必跑——detectKind 虽只认首行,确认无向量/断言意外红）。
```bash
git add -A
git commit -m "feat: etc. 纳入可收句缩写并升双提示词版本"
```

---

## Task 11: S2 Kotlin trimEnd 改共享类剥离（2b）

**Files:**
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/Segmenter.kt:81`
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/SegmenterTest.kt`
- Modify: `shared-fixtures/segmenter-vectors.json`（NBSP/U+001C 尾缀分句向量）

**Interfaces:**
- Consumes: `javascriptWhitespace` 单字符判定（Segmenter.kt:76）
- Produces: 尾部剥离与 TS 显式类逐字符一致

- [ ] **Step 1: 先实测定性（第 1 轮审核更正:公共路径上分叉不可达）**

已实测 30+ 组差分（NBSP/U+001C/U+001D/U+202F/U+FEFF/VT 尾缀 × 缩写 × 大小写）:双端输出**逐字节一致**——`mergesIntoNext` 收到的片段终点永远是边界 offset（空白属下一段开头、由段首 trim 处理,两端都用共享类）,`trimEnd()` 与 TS 尾剥在实际输入上均为无操作。**本任务因此定性为:防御性对齐 + 向量钉一致现状**（防未来片段来源变化时 JVM 全集多剥 U+001C-001F）,不是修一个现行 bug。测试直接写「两段/一段」的一致性断言（绿),勿等红。向量:`inc-nbsp-tail` 与 `inc-u001c-tail`（期望值以双端修后实测一致为准,钉住的就是「一致」本身）。

- [ ] **Step 2: 实现**

:81 的 `text.trimEnd()` 改为手写循环:`while (isNotEmpty && last().let(::javascriptWhitespace)) dropLast(1)`（或按文件内既有循环风格）。注释:「TS 只剥共享 JS whitespace 显式类,JVM trimEnd 全集会多剥 U+001C-001F 等,双端分叉」。

- [ ] **Step 3: 双端测试（向量双端同测）+ Commit**

```bash
git add -A
git commit -m "fix: Kotlin 尾部空白剥离对齐共享显式类"
```

---

## Task 12: 批次 2 收尾门禁

- [ ] **Step 1: 全量双端门禁 + docs:drift**
- [ ] **Step 2: 确认 CHANGELOG 未动（发布节奏由批次 6 统一处理,本批不写 CHANGELOG）**

---

## Task 13: V6 从属连词吞从句门（3b）

**Files:**
- Modify: `chrome-plugin/src/language/analysis-validator.ts`（新词表 + 新门）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt`（含元测试登记）

- Modify: `shared-fixtures/validator-messages.json`（Task 2b 夹具增补本门文案条目,双端同提交）

**Interfaces:**
- Consumes: `lexicalTexts` helper（取第二实词）
- Produces: 新词表（无条件 5 词 + because/though 两个条件款;元测试登记 5）+ 错误文案（见 Step 3,双端逐字）

- [ ] **Step 1: 写失败测试（双端,四组）**

1. `Because the road was flooded` 标 ADVERBIAL → 拒（现状过——红测试）。
2. `Because of this limitation, we stayed home.` 的 `Because of this limitation` 标 ADVERBIAL → 过（because 第二实词是 of）。
3. `The docs don't cover it, though.` 的 `though` 单实词 ADVERBIAL → 过。
4. `Although the road was flooded` 标 ADVERBIAL → 拒。

- [ ] **Step 2: 确认失败模式**

Expected: 1/4 FAIL（须拒未拒）;2/3 PASS（回归侧）。

- [ ] **Step 3: 双端实现（勿复用 21 词全表!）**

新词表（**与 SUBORDINATING_CONJUNCTIONS 分开,勿复用——全表版会红 5 句黄金集**,审计实测）:

```ts
const CLAUSE_ONLY_CONJUNCTIONS: ReadonlySet<string> = new Set([
  "although", "whereas", "unless", "lest", "whilst",
]);
// 门:component.role 为 ADVERBIAL/ATTRIBUTE 且
//   (head ∈ CLAUSE_ONLY_CONJUNCTIONS)
//   || (head === "because" && words[1] !== "of")
//   || (head === "though" && words.length >= 2)
// → addError 文案(规格 1e 模板,双端逐字):
// "a component that starts with a subordinating conjunction (because/although/…) is a clause and must be tagged with a clause role (ADVERBIAL_CLAUSE/…)"
```

Kotlin 同构（`clauseOnlyConjunctions` internal 集合）,条件款用安全形态:**`(head == "because" && words.getOrNull(1) != "of") || (head == "though" && words.size >= 2)`**——必须 `getOrNull`,Kotlin `words[1]` 越界抛异常会被外层 catch 折叠成 `invalid JSON structure`,双端同输入输出分叉（TS `words[1]` 越界返回 undefined,单实词 `because` 成分在 TS 命中门、Kotlin 若照抄则崩）。双端正反例须各补一条:**单实词 `Because` 成分（如 `Because, we stayed.` 的 `Because 0..0` 标 ADVERBIAL）→ 须拒**（TS words[1]===undefined≠of → 命中;Kotlin getOrNull(1)===null≠of → 命中）。

- [ ] **Step 4: 元测试登记 + 双端测试 + replay**

Task 2 的 `word list sizes stay pinned` 追加 `assertEquals(5, clauseOnlyConjunctions.size)`。跑双端 validator 测试 + 黄金集双端 replay（7 词下零命中——审计实测）。

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: 拦截从属连词开头的伪状语定语成分"
```

---

## Task 14: V7 SUBJECT_CLAUSE 引导词闭集门（3c）

**Files:**
- Modify: `chrome-plugin/src/language/analysis-validator.ts`（闭集 + 新门）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt`（含元测试登记）
- Modify: `chrome-plugin/src/shared/architecture-docs.test.ts`（闭集成员数断言）

- Modify: `shared-fixtures/validator-messages.json`（Task 2b 夹具增补本门文案条目,双端同提交）

**Interfaces:**
- Consumes: 现有 SUBJECT_CLAUSE 门位（从句最少实词门附近）
- Produces: `SUBJECT_CLAUSE_INTRODUCERS` 闭集（15 词）+ 文案（规格 1e 模板）

- [ ] **Step 1: 写失败测试（双端）**

1. `developers now play a frontline role` 标 SUBJECT_CLAUSE → 拒（历史实测错误,现状过——红）。**组装必须嵌入完整句子**（如 `INDEPENDENT_ELEMENT(Today,) + SUBJECT_CLAUSE(2..7)` 前置成分形态）——**不得单成分包整句**:单成分组装现状已被整句门拒,红因错误且实现后整句门仍在,测试死红。
2. `Whoever wins gets the prize.` 的 `Whoever wins` 标 SUBJECT_CLAUSE → 过。
3. `How he did it remains a mystery.` 的 `How he did it` → 过。
4. `It is obvious that the cache is stale.` → SUBJECT(It) + PREDICATE(is) + PREDICATIVE(obvious) + SUBJECT_CLAUSE(that the cache is stale)，断言完整合法分析通过。it 为形式主语，后置从句为真正主语，不标 PREDICATIVE_CLAUSE。另以 `The problem is that the cache is stale.` 的 PREDICATIVE_CLAUSE 验证本门不干扰其他角色。

- [ ] **Step 2: 跑测试确认红绿模式**

Run: 双端 validator 测试。
Expected: 用例 1 FAIL（现状闭集门缺失）;用例 2/3/4 PASS（回归侧）。

- [ ] **Step 3: 双端实现**

```ts
const SUBJECT_CLAUSE_INTRODUCERS: ReadonlySet<string> = new Set([
  "that", "whether", "what", "whatever", "which", "whichever",
  "who", "whoever", "whom", "whomever", "whose", "how", "why", "when", "where",
]);
// 刻意不收 "if"(主语从句用 if 非标准)与 "however"(引导让步状语从句)
// 门:component.role === SUBJECT_CLAUSE && !SUBJECT_CLAUSE_INTRODUCERS.has(head)
// → "a SUBJECT_CLAUSE must start with a subject-clause introducer (that/whether/what/who/…); retag or extend the component"
```

Kotlin 同构（`subjectClauseIntroducers` internal）。

- [ ] **Step 4: 元测试 + arch-docs 断言 + replay**

Task 2 元测试追加 `assertEquals(15, subjectClauseIntroducers.size)`;architecture-docs.test.ts 按既有 helper 钉成员数（从源码计数,勿手写——参照 Task 7 Step 4 方式 + 其 Files 的文档前置说明（第 5 轮审核 B2 更正原 Step 5 引用））。黄金集双端 replay（noun-clause-1 what / noun-clause-3 whether 均在闭集内,安全——审计实测）。

- [ ] **Step 5: 双端全量门禁 + Commit**

```bash
git add -A
git commit -m "feat: 主语从句首词必须命中引导词闭集"
```

---

## Task 15: 批次 3 收尾 + 批次 0-3 总结

- [ ] **Step 1: 全量双端门禁 + docs:drift**
- [ ] **Step 2: 核对规格 §2-§5 全条目完成**:0a✓(Task1) 0b✓(Task2) 0c✓(Task3) 0d✓(Task4) 1a✓(Task5) 1b✓(Task6) 1c✓(Task7) 1d✓(Task8) 2a✓(Task10) 2b✓(Task11) 3b✓(Task13) 3c✓(Task14);3a 已随 V5 裁定关闭。文档同步:AGENTS/protocol/model-pipeline/invariants/modules/overview 六处门数措辞随本批更新;**AGENTS.md:46 的「十三条判据」枚举清单逐条对照更新**（第 5 轮审核 B3 更正：硬门段在 :46,:45 是缩写枚举行）（+V6 门 +V7 门;整句门改写为豁免集+上限口径;纯标点口径改写;批次 6 再 -废弃门）,勿只改总数——**门数以代码实际重数为准**（当前 13 门,Task 7 为改造不净增,Task 13/14 各 +1,批次 6 Task 26 合并死门 -1;在此写「十五条」并注明构成）,勿沿用猜测数字。
- [ ] **Step 3: Commit（若有文档补齐）**

---

## 批次 4-6

见续篇 `2026-09-04-accuracy-audit-fixes-batch4-6.md`（提示词补真空、口径统一、低危卫生与发布）。
