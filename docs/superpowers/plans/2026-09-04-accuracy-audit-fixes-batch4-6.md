# 准确性审计修复实施计划（批次 4-6）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地审计批次 4-6：提示词补真空（CORE 12→13、DETAIL 6→7）、黄金集口径统一与双端对齐、低危卫生与发布准备。

**Architecture:** 承接批次 0-3 计划（`2026-09-04-accuracy-audit-fixes-batch0-3.md`，其 Task 10 已把版本升到 CORE 12 / DETAIL 6）。本计划 Task 16-19 为批次 4，Task 20-24 为批次 5，Task 25-30 为批次 6。双端 prompt 逐字同步 + parity fixture 重生成。

**Tech Stack:** 同 Part 1。

**Spec:** `docs/superpowers/specs/2026-09-04-accuracy-audit-fixes-design.md`（§6-§8）
**上游审计:** `docs/superpowers/audits/2026-09-04-accuracy-audit.md`

## Global Constraints

（同 Part 1，另加：）
- 本计划批次 4 升 CORE_PROMPT_VERSION 12→13、DETAIL_PROMPT_VERSION 6→7（版本四文件同步:versions.ts / Domain.kt / contracts.json / core-prompt-parity.json——批次 4 parity 的 prompt 文本也要重生成）。
- 假服务器红线:`Focus:` / `Focus range:` / `Requested focus ranges:` 标记原文不变（fake-openai-server.ts parseFocus :281 / sentenceDetailsTargets :299 依赖）。
- parity 重生成方式:无现成脚本——临时 node 脚本调 `buildCorePrompt`（与 `buildRepairPrompt`/`buildDetailPrompt`）输出后手工更新 `core-prompt-parity.json`。
- 新增黄金句一律人工核语言学正确性 + 补机器口径断言（AGENTS 硬性要求）。
- 批次 4 前、批次 4 后、全部完成后各跑一次真模型评测（`.superpowers/acceptance/run-core-gold-evaluation.mjs`，需环境变量;批次 4 前先重跑现状基线留档——补句后黄金集从 86 句增长，按同句集或逐句 diff 对比，不比旧总分）。

---

## Task 16: 批次 4 前置——真模型基线留档

- [ ] **Step 1: 跑现状基线**

Run: `source ~/.secrets && node .superpowers/acceptance/run-core-gold-evaluation.mjs`（脚本路径已在批次 0 Task 4 改为 shared-fixtures）。
Expected: 产出基线分数文件;保存到 `.superpowers/acceptance/` 下带日期文件名（该目录 gitignored，不入库）。若环境不可用（无 key），记录跳过原因，批次 4 后补跑两次对比。

---

## Task 17: P1-P5 提示词例句与定义（4a-4e + 4e2，CORE 升 13）

**Files:**
- Modify: `chrome-plugin/src/background/prompts.ts`（CORE_ANALYSIS_RULES 各规则常量 + PEER_COMPONENT_RULE + SUPPLEMENT_RULE + PREDICATE_SCOPE_RULE）
- Modify: `chrome-plugin/src/background/prompts.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/model/Prompts.kt`（同构常量）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/model/PromptsTest.kt`
- Modify: `shared-fixtures/core-prompt-parity.json`（prompt 文本重生成 + 版本 13）
- Modify: `chrome-plugin/tests/../shared-fixtures` 黄金集（批次 0 后位于 `shared-fixtures/core-gold-annotations.json`）
- Modify: `chrome-plugin/src/language/core-gold-annotations.test.ts`（新句断言）
- Modify: 版本四文件（CORE→13）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/contract/CoreGoldAnnotationsTest.kt`（新句随遍历自动覆盖,无需改——确认即可）

**Interfaces:**
- Consumes: 批次 0-3 后的黄金集（86 句）与 tokenizer（etc. 已单 token）
- Produces: 五条规则的补句文本（双端逐字）;黄金集 +4 句（PREDICATIVE_CLAUSE×1、SUBJECT_CLAUSE×1、APPOSITIVE/INDEPENDENT_ELEMENT 口径句×2）;CORE_PROMPT_VERSION=13

- [ ] **Step 1: 先写黄金集新句与断言（红）**

新句（全部人工核对语言学正确性后再写入;token 区间用生产 tokenizer 实测确定，勿手算）:

1. `predicative-clause-1`: `The real problem is that the cache entry has expired.` → PREDICATE(is) 前段 SUBJECT(The real problem) + PREDICATIVE_CLAUSE(that the cache entry has expired)整块。
2. `subject-clause-whatever`: `Whoever wins the race gets the final ticket.` → SUBJECT_CLAUSE(Whoever wins the race) + PREDICATE(gets) + OBJECT(the final ticket)。
3. `appositive-clause-1`: `Claude Code, an AI coding assistant, helps developers work faster.` → SUBJECT(Claude Code) + APPOSITIVE(an AI coding assistant) + PREDICATE(helps) + OBJECT(developers) + ADVERBIAL(work faster——若 tokenizer/结构上更适合 OBJECT+COMPLEMENT 则按 `helps you run` 既有黄金口径,人工复核时定)。
4. `independent-element-1`: `Fortunately, the deployment finished without errors.` → INDEPENDENT_ELEMENT(Fortunately) + SUBJECT(the deployment) + PREDICATE(finished) + ADVERBIAL(without errors)。

core-gold-annotations.test.ts:it.each 断言表追加这 4 句的 span 表（照既有 `keeps the human-reviewed component contract` 模式）;角色覆盖断言清单补 `GrammarRole.PREDICATIVE_CLAUSE`（SUBJECT_CLAUSE 已在）。

Run: `cd chrome-plugin && npx vitest run src/language/core-gold-annotations.test.ts`
Expected: FAIL（新句未入 fixture）。

- [ ] **Step 2: 黄金集写入新句 → 测试绿**

fixture sentences 追加 4 句（带 translation 占位，按既有句风格）。跑测试确认绿（含 replay 过双端 15 门——Task 13/14 的新门不拒这些句:predicative-clause-1 的 PREDICATIVE_CLAUSE 首词 that ∈ V7 闭集豁免范围（V7 只管 SUBJECT_CLAUSE）;subject-clause-whatever 首词 whoever ∈ 闭集 ✓）。

- [ ] **Step 3: 写 prompt 断言测试（红）**

prompts.test.ts 追加（Kotlin PromptsTest.kt 同款）:

```ts
it("teaches the three clause roles with one example each", () => {
  const rules = CORE_ANALYSIS_RULES.join("\n"); // 或逐常量断言
  expect(rules).toContain("PREDICATIVE_CLAUSE");  // 且带例句 "that the cache entry has expired"
  expect(rules).toContain("Whoever wins the race"); // SUBJECT_CLAUSE 例
  expect(rules).toContain("Because the road was flooded"); // ADVERBIAL_CLAUSE 例
});
it("defines COMPLEMENT with an object-complement example", () => {
  expect(rules).toContain("consider the tool essential"); // 例句
});
it("separates adjective-complement from noun-postmodifier in fragments", () => {
  expect(COMPLETENESS_FIRST_RULE).toContain("completes an adjective"); // 形容词补足不拆句
});
```

- [ ] **Step 4: 双端改 prompt 文本**

按规格 4a-4e + 4e2 逐条（**双端逐字同步**;每处改动一句英文，贴在对应规则常量内的自然位置）:

- 4a Complex-sentence rule 追加: `'Use PREDICATIVE_CLAUSE for a clause that completes a linking verb ("The real problem is that the cache entry has expired" → the "that…" clause is ONE PREDICATIVE_CLAUSE), SUBJECT_CLAUSE for a clause acting as subject ("Whoever wins the race gets the final ticket" → "Whoever wins the race" is ONE SUBJECT_CLAUSE), and ADVERBIAL_CLAUSE for a subordinate clause acting as an adverbial ("Because the road was flooded, the bus took a longer route." → the "Because…" clause is ONE ADVERBIAL_CLAUSE).'`
- 4b PEER_COMPONENT_RULE 追加: `'A COMPLEMENT completes an object or a verb ("We consider the tool essential" → OBJECT "the tool" plus COMPLEMENT "essential"; "They painted the fence bright blue" → OBJECT plus COMPLEMENT).'`
- 4c COMPLETENESS_FIRST_RULE 追加: `'A prepositional phrase that completes an adjective head stays inside the single FRAGMENT_HEAD ("Compatible with all major model providers" is ONE FRAGMENT_HEAD); only a postmodifier of a noun head separates ("Support for synchronous APIs" is FRAGMENT_HEAD "Support" plus ATTRIBUTE "for synchronous APIs").'`
- 4d COMPLETENESS_FIRST_RULE 末尾追加: `'Inside a full clause a non-finite phrase keeps its normal role (a gerund phrase as SUBJECT or OBJECT, a participial opener as ADVERBIAL); FRAGMENT_HEAD applies only when the whole input is not a clause.'`
- 4e SUPPLEMENT_RULE 追加: `'A comma-braced noun phrase renaming another noun is APPOSITIVE ("Claude Code, an AI coding assistant, …" → "an AI coding assistant" is ONE APPOSITIVE), and a sentence-initial comment adverb is INDEPENDENT_ELEMENT ("Fortunately, …" → "Fortunately" is ONE INDEPENDENT_ELEMENT).'`
- 4e2 PREDICATE_SCOPE_RULE 助动词列表补 `been, being, having`;SUPPLEMENT_RULE 或 PREDICATE_SCOPE_RULE 可选补 seem 一例（实现时定,双端一致）。
- G5 顺带（4c 同提交）: 黄金集 conventions 数组追加「并列**表语**按并列谓词处理,标 CONJUNCTION」与「形容词头的介词补足留在片段主体内,名词头的后置介词短语才分离」（conventions 是中文文本,直接追加两条）。

- [ ] **Step 5: 版本四文件升 13 + parity 重生成**

versions.ts/Domain.kt/contracts.json CORE→13（DETAIL 仍 6,本任务不动 detail prompt）;临时 node 脚本输出新 buildCorePrompt 文本贴进 core-prompt-parity.json（版本字段同步 13）。双端 contract 测试确认绿。

- [ ] **Step 6: 双端全量门禁（playwright 必跑）+ Commit**

```bash
git add -A
git commit -m "feat: 补全低频角色例句与补语定义并升核心提示词版本"
```

---

## Task 18: P7/P9 detail repair 补模板 + 词表对齐（4f，DETAIL 升 7）

**Files:**
- Modify: `chrome-plugin/src/background/analysis-service.ts`（detailRepairPrompt :558-572 补两段）
- Modify: `chrome-plugin/src/background/analysis-service.test.ts`
- Modify: `chrome-plugin/src/background/prompts.ts`（DETAIL_OUTPUT_SHAPE :167 与 SENTENCE_DETAILS_OUTPUT_SHAPE :177 词表句）
- Modify: `chrome-plugin/src/background/prompts.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/analysis/AnalysisService.kt`（detailRepairPrompt :501-519）
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/model/Prompts.kt`（DETAIL_OUTPUT_SHAPE 词表句）
- Modify: 双端对应测试
- Modify: 版本四文件（DETAIL→7）

**Interfaces:**
- Consumes: DETAIL_OUTPUT_SHAPE / MINIFIED_OUTPUT 常量
- Produces: detail repair prompt 含 OUTPUT_SHAPE+MINIFIED 两段;词表句含 表语/同位语/补语/独立成分/片段主体;DETAIL_PROMPT_VERSION=7

- [ ] **Step 1: 写失败测试（双端）**

断言 detailRepairPrompt 文本包含 DETAIL_OUTPUT_SHAPE 的 JSON 形状行与 MINIFIED_OUTPUT 关键句;词表句断言包含「表语」「同位语」「补语」「独立成分」「片段主体」。

- [ ] **Step 2: 双端实现**

TS detailRepairPrompt 数组在 errors 段前插入 `...DETAIL_OUTPUT_SHAPE` 与 MINIFIED_OUTPUT 两行;**假服务器红线:Focus: 标签与原位置不动**。词表句（双端逐字）改为:「role 使用与核心分析一致的中文术语:主语/谓语/宾语/定语/状语/表语/补语/同位语/独立成分/系动词/引导词/连词/片段主体 etc.」——注意 TS 两份载体（:167/:177）都改。Kotlin AnalysisService.kt 同构 + Prompts.kt 词表句。版本 DETAIL→7（四文件）。

- [ ] **Step 3: 双端测试 + playwright（detail E2E 路径）+ Commit**

```bash
git add -A
git commit -m "feat: 详解修复提示词补输出模板并补全中文角色词表"
```

---

## Task 19: P8/P6 标签统一 + parity 守卫 + path 重写（4g）

**Files:**
- Modify: `chrome-plugin/src/background/analysis-service.ts`（:538/:566-567/:583-584 五处标签;repair 组装处 path 重写）
- Modify: `chrome-plugin/src/background/analysis-service.test.ts`
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/analysis/AnalysisService.kt`（:510-512 标签确认对齐;repair 组装处 path 重写）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/analysis/AnalysisServiceTest.kt`
- Modify: `shared-fixtures/core-prompt-parity.json`（增补 repair 与 detail prompt 期望输出）+ 双端 contract 测试消费

**Interfaces:**
- Consumes: Task 17/18 后的版本 13/7
- Produces: 五处标签统一为 `Selected sentence:` / `Verified core result:` 系;repair errors 的 path 为 subset 实际索引;parity fixture 含 repair+detail 期望

- [ ] **Step 1: TS 五处标签改写（已核安全——detectKind 只认首行,E2E 无字面量断言）**

:538 correctionPrompt / :566 detailRepairPrompt / :583 sentenceDetailsRepairPrompt 的 `Sentence and Tokens:` → `Selected sentence:`;:567/:584 的 `Verified core analysis:` → `Verified core result:`。

- [ ] **Step 2: 双端 path 重写（同一口径）**

TS repair 组装处（analysis-service.ts flatMap errors 处）:把每句 errors 的 path 前缀 `sentences[0]` 重写为 `sentences[${subsetIndex}]`（subsetIndex = 该句在 invalidRawSubset 数组中的位置）。Kotlin AnalysisService.kt 同构处同改。**双端逐字同口径**。

- [ ] **Step 3: parity fixture 增补 + 双端断言**

core-prompt-parity.json 追加 `repairPrompt` 与 `detailPrompt` 字段（同款固定输入的期望输出,双端生成互验）;cross-platform-contract.test.ts 与 SharedContractTest.kt 各增断言比对。

- [ ] **Step 4: 双端测试 + playwright 全量（correction 用例重点）+ Commit**

```bash
git add -A
git commit -m "fix: 统一修复提示词标签并修复多句修复路径错位"
```

---

## Task 20: 批次 4 收尾——门禁 + 真模型评测

- [ ] **Step 1: 全量双端门禁 + docs:drift**
- [ ] **Step 2: 真模型评测（对比 Task 16 基线,按同句集 86 句对比或逐句 diff）**

Run: `source ~/.secrets && node .superpowers/acceptance/run-core-gold-evaluation.mjs`
Expected: exact/span F1 不低于基线（新增句集单独看）;若下降,停下分析逐句 diff——prompt 例句改动引起的回归优先于继续批次 5。

---

## Task 21: G2/G3/G4/G6 黄金集口径统一（5a）

**Files:**
- Modify: `shared-fixtures/core-gold-annotations.json`（improved-001、retry-008 两句 + conventions 四条）
- Modify: `chrome-plugin/src/language/core-gold-annotations.test.ts`（若新口径需断言）

**Interfaces:**
- Consumes: 批次 4 后的 90 句黄金集
- Produces: improved-001 拆分标注;retry-008 括注拆分;conventions +4 条口径

- [ ] **Step 1: 修两句标注（人工复核 span,tokenizer 实测）**

- improved-001 `The way we build software has changed.` → SUBJECT(The way 0..1) + ATTRIBUTIVE_CLAUSE(we build software 2..4) + PREDICATE(has changed 5..6)。
- retry-008 `An Architecture Decision Record (ADR) is a short document that captures and explains…` 的 SUBJECT 0..6 拆为 SUBJECT(An Architecture Decision Record 0..3) + APPOSITIVE((ADR) 4..6)。

- [ ] **Step 2: conventions 追加四条**

「`The way we build software` 类接触性从句拆为 ATTRIBUTIVE_CLAUSE,不并入名词短语」「括号缩写注拆为 APPOSITIVE,如 `(ADR)`」「词汇化专名内部的介词短语不拆(如 Git for Windows)」「形容词短语内补足介词短语仍独立成 ADVERBIAL(如 for beginners)」。

- [ ] **Step 3: 黄金集双端 replay + Commit**

```bash
git add -A
git commit -m "test: 统一限定从句与括注的黄金标注口径"
```

---

## Task 22: V9 Kotlin 助动词分支（5b）

**Files:**
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/AnalysisValidator.kt`（auxiliaryModals 集合 + 分支）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/language/AnalysisValidatorTest.kt`（文案断言 + 元测试登记 24）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts`（TS 侧补文案断言——TS 实现已有,只缺断言）

**Interfaces:**
- Consumes: TS `AUXILIARY_MODALS`（24 成员,文案 `auxiliary/modal verb "must" must be merged with the following main verb into one PREDICATE covering the complete verb group`）
- Produces: Kotlin `auxiliaryModals` internal 集合 + 同款分支与文案;双端文案断言

- [ ] **Step 1: TS 补文案断言（红——现状无断言）**
- [ ] **Step 2: Kotlin 实现集合+分支+文案（逐字同 TS;24 成员照抄 TS 列表）+ 双端测试**
- [ ] **Step 3: 元测试登记 assertEquals(24, auxiliaryModals.size) + Commit**

```bash
git add -A
git commit -m "feat: Kotlin 校验器补助动词合并专属文案"
```

---

## Task 23: R1 Kotlin normalize 复用共享常量（5c）

**Files:**
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/language/Segmenter.kt`（jsWhitespaceClass private→internal）
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/analysis/AnalysisService.kt:541`（normalize 用共享类）
- Modify: `intellij-plugin/src/test/kotlin/dev/codetui/englishsyntax/cache/CacheKeysTest.kt` 或新增用例（句内 NBSP）
- Modify: `shared-fixtures/cache-key-vectors.json`（句内 NBSP 向量,若该文件结构支持——先读确认）

**Interfaces:**
- Consumes: jsWhitespaceClass（Segmenter.kt:19）
- Produces: normalize 的 Kotlin/TS 语义一致（Unicode 空白）

- [ ] **Step 1: 写失败测试（句内 NBSP 句子的缓存键 = 空格替换后键）**
- [ ] **Step 2: internal 化常量 + normalize 改 `Regex(jsWhitespaceClass + "+")`（或等价复用）**
- [ ] **Step 3: 双端测试 + Commit**

```bash
git add -A
git commit -m "fix: Kotlin 缓存键归一化对齐 TS Unicode 空白语义"
```

---

## Task 24: R5 流式分片 translation 缺省对齐 + V14 混用集收窄（5d + 5e）

**Files:**
- Modify: `intellij-plugin/src/main/kotlin/dev/codetui/englishsyntax/analysis/AnalysisService.kt:671`（`?: return null` → `?: ""`）
- Modify: `intellij-plugin/src/test/kotlin/.../AnalysisServiceTest.kt`
- Modify: 双端 validator（FRAGMENT_CLAUSE_ROLES 移出 ATTRIBUTIVE_CLAUSE）
- Modify: `chrome-plugin/src/language/analysis-validator.test.ts` / Kotlin AnalysisValidatorTest.kt
- Modify: `shared-fixtures/core-gold-annotations.json`（+2 句「片段+定语从句」）
- Modify: `chrome-plugin/src/language/core-gold-annotations.test.ts`（断言）

**Interfaces:**
- Consumes: FRAGMENT_CLAUSE_ROLES 集合（TS :195-203 / Kotlin :156-162;Task 2 元测试若纳入需同步）
- Produces: 混用门只拒 SUBJECT/PREDICATE/OBJECT/PREDICATIVE/COMPLEMENT + 其余四类从句 + COORDINATE_CLAUSE（ATTRIBUTIVE_CLAUSE 放行）;错误文案更新（双端逐字,原文案删去 ATTRIBUTIVE_CLAUSE 不涉及——原文案列的是 clause roles 泛称,保持原文案不变即可,实现时确认）

- [ ] **Step 1: R5 一行改 + 测试**（Kotlin 分片 translation 缺省 `""` 接受,用例断言不再整片拒绝）
- [ ] **Step 2: V14 红/绿测试**: `An API that returns JSON responses.` → FRAGMENT_HEAD(An API 0..1) + ATTRIBUTIVE_CLAUSE(that returns JSON responses 2..5) 须过（现状拒）;`An API that returns JSON.` + OBJECT 并存仍拒。
- [ ] **Step 3: 双端移出 ATTRIBUTIVE_CLAUSE + 黄金集补 2 句（人工复核）**: `fragment-api-relative`（上句）+ 自造一句真实文档标题带从句（如 `A CLI tool that speeds up your builds.`——FRAGMENT_HEAD(A CLI tool) + ATTRIBUTIVE_CLAUSE(that speeds up your builds)）;断言表追加;replay。
- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 片段允许内嵌定语从句并对齐流式分片缺省"
```

---

## Task 25: V11 Kotlin 整数放宽（6a）

- [ ] **Step 1: Kotlin safeInt 正则放宽接受 `\d+\.0*`;负数文案对齐 TS（负值走区间外文案,删 must be non-negative 专属文案）——双端测试同步**
- [ ] **Step 2: Commit** `fix: Kotlin 整数解析放宽尾零并统一负数文案`

## Task 26: V13 死门合并（6b）

- [ ] **Step 1: 双端删「COORDINATE_CLAUSE 首词从属连词」门（保留废弃门）;清双端对应断言;replay**
- [ ] **Step 2: Commit** `refactor: 合并并列分句死门入废弃门`

## Task 27: R4 cacheOnly 脱敏（6c）

- [ ] **Step 1: service-worker.ts cacheOnly 分支对 lookupCore 结果套 sanitizeCore(空 secrets);测试:缓存中含疑似 key 文本经 cacheOnly 返回时被脱敏**
- [ ] **Step 2: Commit** `fix: 纯缓存分支补脱敏`

## Task 28: R6 bundle 守护扩全量（6d）

- [ ] **Step 1: bootstrap-lifecycle.test.ts 的 bundle 断言从 FRAGMENT_HEAD 单角色扩为遍历 grammar.ts 全部 17 角色逐值断言（标签+双色）;bundle 若未含新词先 `npm run bundle-web` 重建**
- [ ] **Step 2: Commit** `test: bundle 角色映射守护扩为全量`

## Task 29: R2/R7/R8 + 6f 文档与向量（6e + 6f）

- [ ] **Step 1: R2**: learning-block.ts `#placeSentenceSection` 重渲染前检查在飞 detail 请求（session 可查）,迁移/重开 loading 面板;content 侧单测
- [ ] **Step 2: R7**: Kotlin 加「文本变化必须换 sentenceId」守护测试（sentenceId 掺 normalizedText 哈希或 invalidate 语义,按审计 R7 修法二选一,倾向掺哈希与 Chrome 对齐）
- [ ] **Step 3: R8**: service-worker.ts abort 传参处加注释说明取消走 cancelDocument**
- [ ] **Step 4: 6f**: AGENTS/architecture 六处门数措辞按**代码实际重数**更新（批次 3 后为 15,Task 26 合并死门后为 14;含构成说明）;「已知取舍」五项（省略号/非称谓缩写大写例外/裸版本号尾段/专有名词 token/全角闭括号）写进 invariants.md;segmenter-vectors.json 补省略号/裸版本号现状向量;invariants.md 记 V5 防翻案一句
- [ ] **Step 5: Commit** `chore: 低危卫生项与已知取舍文档`

## Task 30: 批次 6 收尾——门禁 + 真模型终评 + 发布准备

- [ ] **Step 1: 全量双端门禁 + docs:drift**
- [ ] **Step 2: 真模型终评（对比 Task 20,全部新句集含入）**
- [ ] **Step 3: CHANGELOG 补两批条目（两次缓存作废 + etc. 行为变化 + 新门清单 + 提示词版本 13/7）;版本发布 1.4.0 准备（发布动作本身由用户执行）**
- [ ] **Step 4: 最终 Commit** `chore: 发布准备与变更记录`
