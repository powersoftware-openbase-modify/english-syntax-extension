# 准确性审计修复设计（批次 0-6）

- **日期**:2026-09-04
- **依据**:[2026-09-04 准确性全局审计](../../superpowers/audits/2026-09-04-accuracy-audit.md)(下称「审计」,条目以 G/V/S/P/R + 编号引用;该文档已经 5 轮独立审阅修正,含已否决方案一览)
- **目标**:修复审计发现的全部 49 项问题中可执行的部分,提高【句子成分划分准确】——项目最高目标。
- **分支**:继续在 `feat/fragment-head`(审计基线 a0c5fff)上开发,不另切分支(用户裁定)。

## 0. 已裁定事项(用户拍板,不再开放)

| 裁定项 | 结论 |
|---|---|
| 修复范围 | **全部批次 0-6**;S3-S6/S8 语义决策项维持现状仅补文档说明,不改行为 |
| V5(逗号隔断相邻 PREDICATE 门) | **放弃该门**——原方案会误杀 conventions 明文的「共享主语不及物谓语串」正确形状(`The system boots, runs, and shuts down cleanly.`);漏判靠 PEER_COMPONENT_RULE 提示词约束;审计 V5 条目与批次 3a 据此关闭,不新增门 |
| V14(片段+内嵌从句口径) | **混用集只放行 ATTRIBUTIVE_CLAUSE**——标题/列表项带关系从句高频且语言自洽,从句卡片保留;其余四类从句照旧拒;黄金集补「片段+定语从句」人工复核句 |
| V12(单成分整句豁免角色集) | **确认三角色 {FRAGMENT_HEAD, INDEPENDENT_ELEMENT, APPOSITIVE} 且实词数 ≤10**——与 V2 合并为统一门(1c) |

## 1. 总体结构

七个批次按依赖顺序落地,每批独立提交、独立过双端门禁:

```
批次 0 数据与钉子(零行为变化)
  → 批次 1 validator 误杀修复(不升 prompt 版本)
  → 批次 2 tokenization 修复(CORE 11→12, DETAIL 5→6)
  → 批次 3 漏判补门(仅 3b/3c)
  → 批次 4 提示词补真空(CORE 12→13, DETAIL 6→7)→ 真模型评测
  → 批次 5 口径统一与双端对齐
  → 批次 6 低危卫生 → 真模型评测 + 发布
```

提交节奏:批次内小项可合并提交,跨批次不合并;每批提交信息中文主题。

## 2. 批次 0:数据与钉子(零行为变化)

| 项 | 内容 |
|----|------|
| 0a | **G1**:修 `improved-008` 标注为 `SUBJECT 0..2 / APPOSITIVE 4..6 / ATTRIBUTE 7..16 / PREDICATE 18..19`(首尾逗号 3、17 退出覆盖);**G7**:of-钉住测试 `nominalRoles` 补 `APPOSITIVE`。同一提交(旧标注+新集合会当场红,这是设计意图) |
| 0b | **V4**:补 `AnalysisValidatorTest.kt` 两个缺失的 `@Test`(:191 FANBOYS 门、:375 整句门);新增词表成员数元测试——基线:6 张字符串词表 coordinatingConjunctions 7 / prepositions 15 / subjectPronouns 7 / determiners 13 / subordinatingConjunctions 21 / objectRequiringPrepositions 11;键集与角色集(clauseRoles 5 / fragmentClauseRoles 11 / clauseInternalFollowers 3)由实现时决定是否纳入;后续批次新增词表(V6 连词表、V7 引导词闭集)增量登记 |
| 0c | **S7**:补共享向量——句尾 URL/邮箱+句点、`?!`/`?"` 连用、`4.5.` 收句、`Please stop.`(反缩写)、`e.g.` 单 token;全部进 `shared-fixtures/segmenter-vectors.json`(双端遍历向量自动同测);省略号/裸版本号向量**不在此批**(随 S3/S5 决策,审计 D11) |
| 0d | **V10**:黄金集搬入 `shared-fixtures/core-gold-annotations.json`;TS 测试改读新路径;Kotlin 新增逐句 `validateCoreBatch` 测试(FixtureLoader 已有 shared-fixtures 定位模式);`src/language/core-gold-annotations.test.ts` 加入 `npm run test:contracts`;同步改 `docs/architecture/modules.md:129`、`build-test-release.md:73` 旧路径;同步改 `.superpowers/acceptance/run-core-gold-evaluation.mjs:21`(gitignored,本环境必改) |

验证:`cd chrome-plugin && npm test && npm run test:contracts`;`(cd intellij-plugin && npm ci && npm test) && ./gradlew :intellij-plugin:test`。

## 3. 批次 1:validator 误杀修复

结构性结论(审计 D10,勿重问):**本批不升任何 PROMPT_VERSION**——repair prompt 的校验错误是逐次请求动态载荷,不进缓存;旧缓存读回重过 validator,违背新门自动当 miss。

| 项 | 内容 |
|----|------|
| 1a | **V1 角色豁免版**:`of/within/between/among` 保留在 `OBJECT_REQUIRING_PREPOSITIONS`,仅当成分 role ∈ 五类从句角色时跳过(从句内部介词悬垂合法);短语角色照旧拦。正例 `That's what dreams are made of.`(过),反例 `near the frontier of` + 宾语从句被外切族(拒) |
| 1b | **V3 最小修复**:ATTRIBUTIVE_CLAUSE 跟随集仅移出 `COMPLEMENT`(前邻判据进阶方案已否决,审计 D3);正例 `We consider the movie that she directed a masterpiece.`(过);双宾 `give the teacher who helped me a book` 残留误杀接受(低频) |
| 1c | **V2+V12 统一门**:单成分覆盖整句且实词 ≥4 时,仅当 `role ∈ {FRAGMENT_HEAD, INDEPENDENT_ELEMENT, APPOSITIVE}` **且**实词数 ≤10 时放行;实现必须同时钉死 `components.length === 1` 与角色条件;正例:9-10 词无介词词汇化标题(过)、`What a wonderful surprise!`(过);反例:11+ 词整句糊弄(拒)。正例**不得含可拆的后置介词短语**(与 4c 口径一致)。上限常量与豁免集进 architecture-docs 断言 |
| 1d | **V8**:TS service 层 `dropPunctuationOnlyComponents` 的预丢弃语义**下沉进双端 validator**(统一为「预丢弃」),correction 路径随之闭合;两端 validator 单元测试同步改(现状各自钉死相反行为) |

每项:双端逐字同步(判定+文案)+ 单测正反例 + 黄金集双端 replay。

## 4. 批次 2:tokenization 修复(升 CORE 11→12 与 DETAIL 5→6)

| 项 | 内容 |
|----|------|
| 2a | **S1**:`etc.` 同时加进主 ABBREVIATIONS 列表与 CONTEXT_SENSITIVE_ABBREVIATIONS(双端同序)。token 化影响:`etc.` 从 `etc`+`.` 两 token 变单 token 且 punctuation=false——这是两版本同升的真正依据。行为:句中小写/数字续接合并;大写新句保留边界 |
| 2b | **S2**:Kotlin `Segmenter.kt:81` 的 `trimEnd()` 改为按共享 `javascriptWhitespace` 类手写尾部剥离(复用文件内已有单字符判定);补 NBSP/U+001C 尾缀向量 |

版本同步四文件:`chrome-plugin/src/shared/versions.ts`、`Domain.kt`、`shared-fixtures/contracts.json`、`core-prompt-parity.json` 版本字段(prompt 文本不动,版本字段必须单独 bump)。文档:AGENTS.md:45、invariants.md:131、overview.md:105/195 的可收句缩写枚举加 `etc.`;AGENTS.md:48 版本号更新。**预期行为:全量 core+detail 缓存作废、用户侧全量重取,验收时勿误判为回归。**

## 5. 批次 3:漏判补门(仅 3b/3c;3a 已随 V5 裁定关闭)

| 项 | 内容 |
|----|------|
| 3b | **V6 修正词表门**:ADVERBIAL/ATTRIBUTE 以从属连词开头且非从句角色时拒绝。词表:`although/whereas/unless/lest/whilst` 无条件收;`because` 仅当第二实词不是 `of` 时收;`though` 仅当成分实词数 ≥2 时收(单实词句尾 `though` 放行)。正例必含 `Because of this limitation, …` 与 `The docs don't cover it, though.`(均须过)。词表进 0b 元测试 |
| 3c | **V7 引导词闭集门**:SUBJECT_CLAUSE 首词 ∈ 闭集 `{that, whether, what, whatever, which, whichever, who, whoever, whom, whomever, whose, how, why, when, where}`(15 词,刻意不收 if/however)否则拒。正例必含 `Whoever wins gets the prize.`/`How he did it remains a mystery.`(过);反例 `developers now play a frontline role` 标 SUBJECT_CLAUSE(拒)。闭集成员数进 architecture-docs 断言与元测试 |

## 6. 批次 4:提示词补真空(CORE 12→13;DETAIL 6→7)

新增黄金句一律**人工核语言学正确性 + 补机器口径断言**(AGENTS 硬性要求)。

| 项 | 内容 |
|----|------|
| 4a | **P1**:Complex-sentence rule 补三例句——PREDICATIVE_CLAUSE(`The problem is that the cache is stale.` 类)、SUBJECT_CLAUSE(复用 V7 例句素材)、ADVERBIAL_CLAUSE(复用 V6 `Because the road was flooded, …`);黄金集补 PREDICATIVE_CLAUSE/SUBJECT_CLAUSE 句(现库 PREDICATIVE_CLAUSE 为 0 句)+ 角色覆盖断言补这两个角色 |
| 4b | **P2**:COMPLEMENT 补一句定义 + 宾补一例(`consider the tool essential` 类);黄金集补口径断言(现有 4 句:complement-2/3、doc-causative-1、doc-adverbial-clause-2) |
| 4c | **P3**:COMPLETENESS_FIRST_RULE 补「形容词头的介词补足留在 FRAGMENT_HEAD 内,名词头的后置介词短语才分离」一句 + 例(`Compatible with…` 不拆 vs `Support for…` 拆);conventions 同步;**G5 顺带**(并列表语标 CONJUNCTION 口径) |
| 4d | **P4**:规则末尾补「句内非限定短语保持正常角色(动名词作 SUBJECT/OBJECT、分词开头作 ADVERBIAL);FRAGMENT_HEAD 仅当整个输入不成句」+ 一例 |
| 4e | **P5**:APPOSITIVE(逗号包围同位语)与 INDEPENDENT_ELEMENT(句首插入语 Fortunately, …)各补一例 + 与 ADVERBIAL 的界线 |
| 4f | **P7+P9**:detail repair prompt 补 DETAIL_OUTPUT_SHAPE 与 MINIFIED_OUTPUT 两段;DETAIL_OUTPUT_SHAPE 中文角色词表补 表语/同位语/补语/独立成分/片段主体 + 「focus 角色用与核心分析同名中文术语」一句 |
| 4g | **P8+P6/R3**:统一三处 repair/detail 标签(TS repair 的 `Sentence and Tokens:` 等对齐首轮 `Selected sentence:` 等);parity fixture 增补 repair 与 detail prompt 期望输出;repair path 重写为该句在 subset 中的实际索引(实测不破既有断言;与 P8 同批) |

parity 更新方式:无现成脚本——临时 node 脚本调 `buildCorePrompt` 输出后手工更新 `core-prompt-parity.json` 的 prompt 与版本字段。**假服务器红线**:`Focus:`/`Focus range:` 与 `Requested focus ranges:` 标记原文不变(横切 4,mid-prompt 标记)。落地后跑真模型评测(先重跑现状基线留档,补句后按同句集对比,不比旧总分)。

## 7. 批次 5:口径统一与双端对齐

| 项 | 内容 |
|----|------|
| 5a | **G2**:`improved-001` 拆为 `SUBJECT 0..1 + ATTRIBUTIVE_CLAUSE 2..4 + PREDICATE 5..6`;**G3**:`retry-008` 括注对齐 improved-003 口径(`SUBJECT 0..3 + APPOSITIVE 4..6`);**G4**:conventions 补「词汇化专名内部的介词短语不拆」;**G6**:conventions 注明「形容词短语内补足介词短语仍独立成 ADVERBIAL」。逐句人工复核 + replay |
| 5b | **V9**:Kotlin 补 `auxiliaryModals` 集合与专属文案分支(以 TS 文案为准),双端各补文案断言;auxiliaryModals 进 0b 元测试 |
| 5c | **R1**:Kotlin `AnalysisService` 的 normalize 复用 Segmenter 的共享 whitespace 常量(提为 internal,**不手写第三份**);缓存键向量补句内 NBSP 用例 |
| 5d | **R5**:Kotlin 流式分片 translation 缺省对齐 TS(缺失→`""` 接受,渐进增强语义) |
| 5e | **V14**:混用集只移出 `ATTRIBUTIVE_CLAUSE`(已裁定);错误文案双端同步更新;黄金集补 2-3 句「片段+定语从句」(含 `An API that returns JSON responses.`)+ 机器断言;replay |

## 8. 批次 6:低危卫生

| 项 | 内容 |
|----|------|
| 6a | **V11**:Kotlin 整数正则放宽接受 `\d+\.0*` 尾零;负数文案对齐 TS(负值走区间外文案) |
| 6b | **V13**:COORDINATE_CLAUSE 从属连词死门合并进废弃门(保留废弃门文案),纯重构 |
| 6c | **R4**:Chrome cacheOnly 分支对缓存值套空 secrets 脱敏(或写缓存前脱敏,键不含 profile 不破坏命中) |
| 6d | **R6**:bundle 守护从单角色断言扩为 17 角色全量同源比对 |
| 6e | **R2/R7/R8**:按审计定论低优先处理或记录(R7 至少加守护测试;R8 注释说明);**P10/P11/P12** 随本批顺手做——它们是 prompt 文本变化,落地于批次 6 时必须再升 CORE_PROMPT_VERSION(版本矩阵无例外;代价是再作废一次 core 缓存,可接受)。若届时批次 4 尚未发布,可评估把 P10-P12 提前并入批次 4 一次升版本(实现时择一,写进提交信息) |
| 6f | **S3-S6/S8**:维持现状,AGENTS/architecture 文档补「已知取舍」说明(省略号断句、非称谓缩写大写例外、裸版本号尾段回并、专有名词 token 碎片化、全角闭括号) |

## 9. 横切约束(全批次)

1. 双端逐字同步:validator 判定+文案、prompt 规则文本、词表成员——TS/Kotlin + contracts.json/parity fixture 一致。
2. 版本矩阵:core prompt 动→CORE+1;detail prompt 动→DETAIL+1;tokenization 动→两条同升;repair/correction prompt 文本变化不升版本。同步点四文件(见 §4)。
3. 黄金集 replay:每条新门/改门后整份过**双端** validator(0d 起 Kotlin 侧可用)。
4. 假服务器:detectKind 只认首行;`Focus:`/`Requested focus ranges:` 标记原文不变;改 prompt 后跑 playwright 全量。
5. 文档同步:门数(六处含 overview.md)、词表、版本号、缩写枚举;`npm run docs:drift`。
6. 门禁:每批 chrome(`npm test` + playwright + lint 恰 1 既有错误 + format:check + build)+ intellij(npm test + gradle test + buildPlugin + verifyPluginProjectConfiguration)。
7. 真模型评测:批次 4 前(现状基线留档)、批次 4 后、全部完成后(同句集/逐句 diff 对比)。
8. 发布:合并一次发布(建议 1.4.0);CHANGELOG 记录两次缓存作废与 etc. 分句行为变化;「全量重取」列入验收清单为预期行为。

## 10. 明确不做(本次范围外)

- V5 新门(已裁定放弃);S3-S8 行为变更(仅文档);`feat/fragment-head` 合并回 main 与发布时点(由用户另行决定);审计中被否决的全部方案(见审计横切 9 一览)。
