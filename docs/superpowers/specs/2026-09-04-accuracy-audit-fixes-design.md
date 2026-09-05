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

## 0.1 准确性优先的修订约束（2026-09-05）

本轮按用户批准的审阅意见补强规格与实施计划；不改变七批次范围、不擅自撤销 §0 已裁定事项。审计是历史论证记录，执行口径以本规格及同步修订的计划为准。

- **成功标准是用户最终看到的成分边界与角色更准确**，不是门数、测试数量或中文译文更流畅。局部译文仅作辅助，不用中文语序决定英文 span。
- **区分推荐标注与宽容接收**：validator 允许一种输出，不代表黄金集应推荐它。独立名词标题推荐 FRAGMENT_HEAD；APPOSITIVE 用于确有同位关系的成分，不把无同位对象的独立标题作为 APPOSITIVE 的语言学正例。三角色接收豁免仍按 §0 保留，相关测试标明“容错接收”。
- **10 实词上限是待验证的启发式限制，不是语法定律**：improved-008 的 ATTRIBUTE 长度与“整句单片段”不是同一适用对象，不能作为阈值正确性的证据。Task 7 必须加入 9/10/11+ 实词的真实标题、名词片段、形容词片段挑战集，同时检查短完整句伪装 FRAGMENT_HEAD 的漏判。若人工认可且按本项目粒度不可再拆的长片段被拒，记录为误杀并暂停该门行为落地，提交证据请用户复核原裁定；不得为了过门虚构修饰语或改错黄金答案。
- **标注先于断言**：`helps developers work faster` 按 OBJECT(developers) + COMPLEMENT(work faster)；`It is obvious that the cache is stale.` 按形式主语结构，obvious 为 PREDICATIVE，后置 that 从句为 SUBJECT_CLAUSE。不得用测试不检查该角色作为保留错标的理由。
- **口径作用域明确**：不成句的形容词片段中，补足介词短语留在 FRAGMENT_HEAD 内；完整分句中采用既有学习粒度，形容词表语后的补足介词短语另标 ADVERBIAL。两者都写入 prompt 与 conventions，并分别给正例。片段带定语从句的推荐形状是 FRAGMENT_HEAD + ATTRIBUTIVE_CLAUSE，在批次 4 的 prompt 中提前明确，批次 5 放宽 validator 并入库回归句。

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
| 0b | **V4**:补 `AnalysisValidatorTest.kt` 两个缺失的 `@Test`(:191 FANBOYS 门、:375 整句门);新增词表成员数元测试——**可见性方案(前置,否则无法落地)**:Kotlin 六张字符串词表 `private` → `internal`(文件级 private 对同包测试不可见;Gradle test source set 是 main 的 friend path,internal 可见,零行为变化同批提交);TS 侧词表为模块级非导出 const——由元测试读 `analysis-validator.ts` 源文本计数(或导出,实现时择一,不得为此改判定逻辑)。基线:6 张字符串词表 coordinatingConjunctions 7 / prepositions 15 / subjectPronouns 7 / determiners 13 / subordinatingConjunctions 21 / objectRequiringPrepositions 11;键集与角色集(clauseRoles 5 / fragmentClauseRoles 11 / clauseInternalFollowers 3)由实现时决定是否纳入;后续批次新增词表增量登记(时序:与各自实现**同提交**,不是 TDD 红步——符号不存在时编译不过):3b V6 连词表、3c V7 引导词闭集(architecture-docs 断言的取真值路径同此——导出集合数成员或源文本计数,勿手写数字)、5b auxiliaryModals(TS 实测 **24** 成员:9 情态 + 8 be + 4 have + 3 do 形式) |
| 0c | **S7**:补共享向量——句尾 URL/邮箱+句点、`?!`/`?"` 连用、`4.5.` 收句、`Please stop.`(反缩写)、`e.g.` 单 token;全部进 `shared-fixtures/segmenter-vectors.json`(双端遍历向量自动同测);省略号/裸版本号向量**后移至批次 6f**(裁定维持现状后钉住现状,见 6f) |
| 0d | **V10**:黄金集搬入 `shared-fixtures/core-gold-annotations.json`;TS 测试改读新路径;Kotlin 新增逐句 `validateCoreBatch` 测试(FixtureLoader 已有 shared-fixtures 定位模式);`src/language/core-gold-annotations.test.ts` 加入 `npm run test:contracts`;同步改 `docs/architecture/modules.md:129`、`build-test-release.md:73` 旧路径;同步改 `.superpowers/acceptance/run-core-gold-evaluation.mjs:21`(gitignored,本环境必改) |

验证:`cd chrome-plugin && npm test && npm run test:contracts`;`(cd intellij-plugin && npm ci && npm test) && ./gradlew :intellij-plugin:test`。

## 3. 批次 1:validator 误杀修复

结构性结论(审计 D10,勿重问):**本批不升任何 PROMPT_VERSION**——repair prompt 的校验错误是逐次请求动态载荷,不进缓存;旧缓存读回重过 validator,违背新门自动当 miss。

| 项 | 内容 |
|----|------|
| 1a | **V1 角色豁免版**:`of/within/between/among` 保留在 `OBJECT_REQUIRING_PREPOSITIONS`,仅当成分 role ∈ 五类从句角色时跳过(从句内部介词悬垂合法);短语角色照旧拦。正例 `That's what dreams are made of.`(过),反例 `near the frontier of` + 宾语从句被外切族(拒) |
| 1b | **V3 最小修复**:ATTRIBUTIVE_CLAUSE 跟随集仅移出 `COMPLEMENT`(前邻判据进阶方案已否决,审计 D3);正例 `We consider the movie that she directed a masterpiece.`(过);双宾 `give the teacher who helped me a book` 残留误杀接受(低频) |
| 1c | **V2+V12 统一门**:单成分覆盖整句且实词 ≥4 时,仅当 `role ∈ {FRAGMENT_HEAD, INDEPENDENT_ELEMENT, APPOSITIVE}` **且**实词数 ≤10 时放行;实现必须同时钉死 `components.length === 1` 与角色条件(两端整句门已按 `length===1` 取单成分,改动即把 `role !== FRAGMENT_HEAD` 换成豁免集 + `≤10`,增量极小);正例:9-10 词无介词词汇化标题(过,优先从真实文档标题选,需人工核语言学正确性)、`What a wonderful surprise!`(过);反例:11+ 词整句糊弄(拒)。正例**不得含可拆的后置介词短语**(与 4c 口径一致)。上限 10 沿用已裁定的启发式值，不以 improved-008 的 ATTRIBUTE 长度作为依据；落地前必须完成 §0.1 的长片段挑战验证，发现误杀则暂停并报告。上限常量与豁免集进 architecture-docs 断言 |
| 1d | **V8**:TS service 层 `dropPunctuationOnlyComponents` 的预丢弃语义**下沉进双端 validator**(统一为「预丢弃」),correction 路径随之闭合;两端 validator 单元测试同步改(现状各自钉死相反行为;**新文案预告**:TS 侧纯标点结构错误文案 `component must not contain only punctuation` 将被 Kotlin 现有语义取代——整句全纯标点时产出 `must contain a non-punctuation component`,TS 旧反例断言组同步改);shared-fixtures 补纯标点成分对照向量 |
| 1e | **(模板存档,非本批动作)新门错误文案初稿**——3b/3c 落地时按此模板双端逐字抄,不得各自造:V6 门:`a component that starts with a subordinating conjunction (because/although/…) is a clause and must be tagged with a clause role (ADVERBIAL_CLAUSE/…)`,V7 门:`a SUBJECT_CLAUSE must start with a subject-clause introducer (that/whether/what/who/…); retag or extend the component`。实现时可微调措辞但双端必须逐字一致 |

1a-1d 每项:双端逐字同步(判定+文案)+ 单测正反例 + 黄金集双端 replay。

## 4. 批次 2:tokenization 修复(升 CORE 11→12 与 DETAIL 5→6)

| 项 | 内容 |
|----|------|
| 2a | **S1**:`etc.` 同时加进主 ABBREVIATIONS 列表与 CONTEXT_SENSITIVE_ABBREVIATIONS(双端同序)。token 化影响:`etc.` 从 `etc`+`.` 两 token 变单 token 且 punctuation=false——这是两版本同升的真正依据。行为:句中小写/数字续接合并;大写新句保留边界 |
| 2b | **S2**:Kotlin `Segmenter.kt:81` 的 `trimEnd()` 改为按共享 `javascriptWhitespace` 类手写尾部剥离(复用文件内已有单字符判定);补 NBSP/U+001C 尾缀**分句**向量(期望:NBSP 尾缀按共享类剥→两段;U+001C 不在共享类→边界 lookahead 不成立,一段——实现时按修后行为核实再钉) |

版本同步四文件:`chrome-plugin/src/shared/versions.ts`、`Domain.kt`、`shared-fixtures/contracts.json`、`core-prompt-parity.json` 版本字段(prompt 文本不动,版本字段必须单独 bump)。文档:AGENTS.md:45、invariants.md:131、overview.md:105/195 的可收句缩写枚举加 `etc.`(注明属可收句类而非强非终结类——防 S1 已否决方案的陷阱);AGENTS.md:48 版本号更新。**预期行为:全量 core+detail 缓存作废、用户侧全量重取,验收时勿误判为回归。**

## 5. 批次 3:漏判补门(仅 3b/3c;3a 已随 V5 裁定关闭)

| 项 | 内容 |
|----|------|
| 3b | **V6 修正词表门**:ADVERBIAL/ATTRIBUTE 以从属连词开头且非从句角色时拒绝。**防呆:勿复用现有 21 词 `SUBORDINATING_CONJUNCTIONS` 全表——已实测会让黄金集 replay 红 5 句**(passive-2/non-finite-1/doc-conditional-clause-1/doc-causative-1/auto-gen-019 的 before/as/after 介词用法);必须新建 7 词表:`although/whereas/unless/lest/whilst` 无条件收;`because` 仅当第二实词不是 `of` 时收(复用双端现有 `lexicalTexts` helper 取第二实词);`though` 仅当成分实词数 ≥2 时收(单实词句尾 `though` 放行)。正例必含 `Because of this limitation, …` 与 `The docs don't cover it, though.`(均须过)。词表进 0b 元测试。文案模板见 1e |
| 3c | **V7 引导词闭集门**:SUBJECT_CLAUSE 首词 ∈ 闭集 `{that, whether, what, whatever, which, whichever, who, whoever, whom, whomever, whose, how, why, when, where}`(15 词,刻意不收 if/however)否则拒。正例必含 `Whoever wins gets the prize.`/`How he did it remains a mystery.`(过);反例 `developers now play a frontline role` 标 SUBJECT_CLAUSE(拒)。闭集成员数进 architecture-docs 断言与元测试 |

## 6. 批次 4:提示词补真空(CORE 12→13;DETAIL 6→7;**含 P10-P12**,见 6e 定论)

新增黄金句一律**人工核语言学正确性 + 补机器口径断言**(AGENTS 硬性要求)。

| 项 | 内容 |
|----|------|
| 4a | **P1**:Complex-sentence rule 补三例句——PREDICATIVE_CLAUSE(`The problem is that the cache is stale.` 类)、SUBJECT_CLAUSE(复用 V7 例句素材)、ADVERBIAL_CLAUSE(复用 V6 `Because the road was flooded, …`);黄金集补 PREDICATIVE_CLAUSE/SUBJECT_CLAUSE 句(现库 PREDICATIVE_CLAUSE 为 0 句)+ 角色覆盖断言补 PREDICATIVE_CLAUSE(SUBJECT_CLAUSE 已在断言清单内,只需补句) |
| 4b | **P2**:COMPLEMENT 补一句定义 + 宾补一例(`consider the tool essential` 类);黄金集补口径断言(现有 4 句:complement-2/3、doc-causative-1、doc-adverbial-clause-2) |
| 4c | **P3**:COMPLETENESS_FIRST_RULE 补「形容词头的介词补足留在 FRAGMENT_HEAD 内,名词头的后置介词短语才分离」一句 + 例(`Compatible with…` 不拆 vs `Support for…` 拆);conventions 同步;**G5 顺带**(并列表语标 CONJUNCTION 口径) |
| 4d | **P4**:规则末尾补「句内非限定短语保持正常角色(动名词作 SUBJECT/OBJECT、分词开头作 ADVERBIAL);FRAGMENT_HEAD 仅当整个输入不成句」+ 一例 |
| 4e | **P5**:APPOSITIVE(逗号包围同位语)与 INDEPENDENT_ELEMENT(句首插入语 Fortunately, …)各补一例 + 与 ADVERBIAL 的界线;黄金集补机器断言(审计 P5 明文要求,断言要求不随例句自动产生) |
| 4e2 | **P10/P11/P12(定论提前并入)**:PREDICATE_SCOPE_RULE 助动词列表补 been/being/having(或改措辞「be/have/do 的全部形式」);系动词可选补 seem 一例;prompt 措辞镜像化(FRAGMENT_HEAD 数量表述与 validator 对齐)。随本批一次升 CORE 12→13 |
| 4f | **P7+P9**:detail repair prompt 补 DETAIL_OUTPUT_SHAPE 与 MINIFIED_OUTPUT 两段;DETAIL_OUTPUT_SHAPE 中文角色词表补 表语/同位语/补语/独立成分/片段主体 + 「focus 角色用与核心分析同名中文术语」一句;**TS 侧词表句有两份载体**:`DETAIL_OUTPUT_SHAPE`(prompts.ts:167)与 `SENTENCE_DETAILS_OUTPUT_SHAPE`(prompts.ts:177)同步改——漏改 sentence-details 那份无测试会红(Kotlin 无该路径),须在提交前自查 |
| 4g | **P8+审计 R3(P6 同源)**:统一 TS 三处 `Sentence and Tokens:` 标签(analysis-service.ts 的 correctionPrompt :538 / detailRepairPrompt :566 / sentenceDetailsRepairPrompt :583,correctionPrompt 为 TS 独有路径、随同批对齐)为 `Selected sentence:` 系;**第四、五处分叉顺手对齐**:TS detailRepairPrompt 的 `Verified core analysis:`(:567)与 sentenceDetailsRepairPrompt 同款(:584)→ 对齐 `Verified core result:`(首轮与 Kotlin 同款;:584 为 TS 独有路径无 parity 守卫),否则 4g 新增的 parity 守卫会揪出 :567;parity fixture 增补 repair 与 detail prompt 期望输出(core repair 双端标签现状一致,仅补 parity 守卫);repair path 重写为该句在 subset 中的实际索引(**落点:双端 service 层收集 errors 处——TS analysis-service.ts 的 repair 组装、Kotlin AnalysisService.kt 同构处,两端采用同一重写口径**(path 一律改写为该句在 subset 中的实际索引),否则 parity 守卫红;实测不破既有断言;与 P8 同批)。**已核安全**:detectKind 全部 startsWith 首行,correction 首行 `Reanalyze the supplied sentence…` 不动,E2E correction 用例只依赖 fetch 计数与反馈文本,无测试断言 `Sentence and Tokens:` 字面量 |

parity 更新方式:无现成脚本——临时 node 脚本调 `buildCorePrompt` 输出后手工更新 `core-prompt-parity.json` 的 prompt 与版本字段。**假服务器红线**:`Focus:`/`Focus range:` 与 `Requested focus ranges:` 标记原文不变(横切 4,mid-prompt 标记)。落地后跑真模型评测(先重跑现状基线留档,补句后按同句集对比,不比旧总分)。

## 7. 批次 5:口径统一与双端对齐

| 项 | 内容 |
|----|------|
| 5a | **G2**:`improved-001` 拆为 `SUBJECT 0..1 + ATTRIBUTIVE_CLAUSE 2..4 + PREDICATE 5..6`;**G3**:`retry-008` 括注对齐 improved-003 口径(`SUBJECT 0..3 + APPOSITIVE 4..6`)+ conventions 补一句括注口径;**G4**:conventions 补「词汇化专名内部的介词短语不拆」;**G6**:conventions 注明「完整分句中形容词表语后的补足介词短语独立成 ADVERBIAL；不成句的形容词片段则留在 FRAGMENT_HEAD 内」(core prompt 在 4c 同步教该区分)。逐句人工复核 + replay |
| 5b | **V9**:Kotlin 补 `auxiliaryModals` 集合与专属文案分支(以 TS 文案为准),双端各补文案断言;auxiliaryModals 进 0b 元测试 |
| 5c | **R1**:Kotlin `AnalysisService` 的 normalize 复用 Segmenter 的共享 whitespace 常量(提为 internal,**不手写第三份**);缓存键向量补句内 NBSP 用例 |
| 5d | **R5**:Kotlin 流式分片 translation 缺省对齐 TS(AnalysisService.kt:671 的 `?: return null` 整片拒绝 → 缺失时 `""` 接受,渐进增强语义) |
| 5e | **V14**:混用集只移出 `ATTRIBUTIVE_CLAUSE`(已裁定);错误文案双端同步更新;黄金集补 2-3 句「片段+定语从句」(含 `An API that returns JSON responses.`)+ 机器断言;replay |

## 8. 批次 6:低危卫生

| 项 | 内容 |
|----|------|
| 6a | **V11**:Kotlin 整数正则放宽接受 `\d+\.0*` 尾零;负数文案对齐 TS(负值走区间外文案);**指数记法 `1e2` 分叉刻意保留**(TS 收/Kotlin 拒,模型输出该形态概率极低,文档注明防后人当 bug 修) |
| 6b | **V13**:COORDINATE_CLAUSE 从属连词死门合并进废弃门(保留废弃门文案),纯重构;双端若有钉该门专属文案的断言同步清理 |
| 6c | **R4**:Chrome cacheOnly 分支对缓存值套空 secrets 脱敏(或写缓存前脱敏,键不含 profile 不破坏命中) |
| 6d | **R6**:bundle 守护从单角色断言扩为 17 角色全量同源比对 |
| 6e | **R2**(明确处理,非仅记录:重渲染前检查在飞 detail 请求,迁移/重开 loading 面板——审计 R2 修法)/ **R7**(至少加守护测试)/ **R8**(注释说明);**P10/P11/P12 定论:提前并入批次 4(见 4e2)**——本计划合并一次发布,批次 4 与 6 之间无发布点,「批次 6 再升一次版本」徒增决策负担与版本跳动;批次 4 的 prompt 改动一次升 CORE 12→13,批次 6 不再动 core prompt |
| 6f | **S3-S6/S8**:维持现状,AGENTS/architecture 文档补「已知取舍」说明(省略号断句、非称谓缩写大写例外、裸版本号尾段回并、专有名词 token 碎片化、全角闭括号);**随「维持现状」裁定,0c 后移的省略号/裸版本号向量在本批补进共享向量**(钉住现状防意外漂移——原后移理由「避免钉住即将废弃的行为」随裁定失效);invariants.md 顺手记一句「相邻 PREDICATE 逗号隔断刻意不拦(会误杀共享主语不及物谓语串)」(V5 防翻案) |

## 9. 横切约束(全批次)

1. 双端逐字同步:validator 判定+文案、prompt 规则文本、词表成员——TS/Kotlin + contracts.json/parity fixture 一致。
2. 版本矩阵:core prompt 动→CORE+1;detail prompt 动→DETAIL+1;tokenization 动→两条同升;repair/correction prompt 文本变化不升版本。同步点四文件(见 §4)。
3. 黄金集 replay:每条新门/改门后整份过**双端** validator(0d 起 Kotlin 侧可用)。
4. 假服务器:detectKind 只认首行;`Focus:`/`Requested focus ranges:` 标记原文不变;改 prompt 后跑 playwright 全量。
5. 文档同步:门数(六处含 overview.md)、词表、版本号、缩写枚举;`npm run docs:drift`。
6. 门禁:每批 chrome(`npm test` + playwright + lint 恰 1 既有错误 + format:check + build)+ intellij(npm test + gradle test + buildPlugin + verifyPluginProjectConfiguration)。
7. 真模型评测:按 §9.1 执行首轮与生产链路双轨评测。批次 0 数据修正后、批次 1 行为改动前留生产链路基线；批次 4 前留 prompt 基线，批次 4 后与全部完成后复测。Task 0E 先准备离线可测的评测接入与固定语料。无模型访问条件可继续离线开发，但准确性验收标为待完成，不以“只加例句所以低风险”替代证据。
8. 发布:合并一次发布(建议 1.4.0);CHANGELOG 记录**两次**缓存作废(批次 2 与批次 4——P10-P12 已定论并入批次 4,批次 6 不再动 core prompt)与 etc. 分句行为变化;「全量重取」列入验收清单为预期行为。
9. 提交节奏细化:0a 与 0d 分开提交(数据修正 vs 基建搬家,replay 语义不同);每批提交前跑 `npm run docs:drift`;全计划单分支顺序执行,**不需要 worktree**;新黄金句不得早于批次 2 入库(避免旧 tokenizer token 序列返工)。

## 9.1 准确性验收协议

1. **两轨不能混为一分**：保留现有直接 buildCorePrompt 的首轮评分；增加调用生产 CachedAnalysisService.analyzeCore 的链路评分，覆盖真实 validator、逐轮收窄的最多两轮 repair、最终失败。冷缓存且 bypassCache=true。IntelliJ 使用 AnalysisServiceTest 的请求记录 seam 回放相同响应轨迹，验证同输入的接受/拒绝及最终 span/role 与 TS 一致，不能用“TS 终评通过”宣称 Kotlin 已验证。
2. **同次请求配对**：adapter 记录同一次服务调用的首轮输出、repair 输出与请求次数，首轮和最终输出分别评分；不要另调一次模型来推断“修坏”。记录正确首轮被拒数、其中 grammar/非 grammar 错误原因、首轮错→最终对数、首轮对→最终错或失败数、最终失败数。分母固定为评测全集，失败句不得从准确率分母排除；正确首轮被拒比例的分母为首轮语法 exact 的句数，分母为零时报告 N/A。
3. **主指标**：首轮与最终的整句 exact、span F1、labeled-span F1、exact-span role accuracy 均报；上线判断以最终整句 exact 和 labeled-span F1 为主。分别报告片段、从句、宾补、介词附着、并列结构等类别及每句差异，不能用总分掩盖某类系统性退化。长度门挑战中已确认的合法不可拆片段误杀是阻断项。
4. **语料隔离**：规则回归集可含 prompt 例句；独立留出集不得写进 prompt，至少覆盖上述五类，每类至少 4 个真实文档或独立改写样本，含易混淆反例。记录来源/标注依据并人工复核；每个新黄金标注附 span/role 断言。留出集一旦用于调 prompt，就转为开发集并补新留出句。批次 2 前只冻结文本、来源和人工词语边界，不提前将新句写进共享黄金集；评测时按各版本 tokenizer 将词语边界映射成 token span。
5. **可比性**：固定语料文本、黄金标注口径、模型标识、请求参数、批大小与顺序，首轮/最终至少各报告三次配对运行的均值及范围（来自同三次服务轨迹）。artifact 保存 git commit、prompt 文本及其哈希、版本、tokenizer/语料快照及其哈希、逐句输入输出与错误，全部脱敏。黄金口径修订后重评保存的旧输出；tokenizer 改动须先按各自输入 tokens 映射到原文字符边界后比较，禁止直接比较不同坐标系的 token span。补句不能混入旧全集总分，交集与新增集分开报告。
6. **验收结论**：相同配置/同句集的最终整句 exact 与 labeled-span F1 均值不得低于基线；检查三次范围与逐句回归，对下降或波动导致结论不稳的项追加复测，不宣称提升。新增误杀、repair 修坏必须逐条人工归因，未解决的系统性语法退化阻断准确性验收。没有前后证据只能报告绝对分与限制，状态为“准确性验收待完成”；保留旧 commit 与 prompt 快照以便有 key 后补跑，不能拿新 prompt 冒充旧基线。已有接受的残留误杀单列，不偷偷从分母移除。
7. **离线与联网分离**：计分与轨迹转换测试使用固定响应，纳入 CI；真实 API 只由 gitignored acceptance 脚本手动运行。禁止 CI 联网、禁止读取或输出密钥文件内容。

## 10. 明确不做(本次范围外)

- V5 新门(已裁定放弃);S3-S8 行为变更(仅文档);`feat/fragment-head` 合并回 main 与发布时点(由用户另行决定);审计中被否决的全部方案(见审计横切 9 一览)。
