# 句子成分划分准确性 · 全局审计报告与修复计划

- **日期**:2026-09-04
- **基线**:分支 `feat/fragment-head`(HEAD `a0c5fff`,含 FRAGMENT_HEAD 支持)
- **方法**:5 路独立只读调查(黄金集语言学复核 / validator 硬门 / 分句分词 / 双端提示词 / 运行时链路),主对话对最高严重度发现逐条 spot-check 核实。本报告只陈述经过核实的发现;子代理原始报告中未通过核实的细节已剔除或降级。
- **目标排序**:项目的最高目标是**句子成分划分准确**;修复优先级按「不误杀 > 不漏判 > 口径统一 > 卫生」排序。

## 0. 总体结论

1. **无 Critical 级静默损坏路径**:双端 core prompt 逐字一致且被 parity fixture 钉住;validator 13 条门判定逻辑双端一致(已知分叉三处:V8 纯标点判定、V9 Kotlin 缺助动词分支、V11 整数解析边界);缓存读回必过 validator;generation 守卫闭合;repair 按 sentenceId 精确配对且不做区间重映射。「模型输出正确但用户看到错误划分」的链路级路径未发现。
2. **准确性风险集中在三层**:黄金集自身残留错标与口径空档(评分器奖励错误)、validator 的无解误杀与漏判、提示词对低频角色的真空(错误直接写缓存长期显示)。
3. **两条已亲验的基建缺陷**:Kotlin 两个 validator 测试缺 `@Test`(对应硬门在 Kotlin 侧零执行中的测试);`etc.` 不在缩写白名单(注释却点名它是预防性补充)。

## 1. 问题清单

严重度定义:High = 直接导致错误划分或守护失效;Medium = 特定模式出错或口径空档;Low = 卫生/低频;Info = 仅记录,不构成缺陷。每条给稳定 ID 供后续修复引用。

### A. 黄金集数据与钉住(gold set,现状 86 句 / 14 条 conventions)

| ID | 严重度 | 问题 | 证据 | 机理与后果 | 修复方向 |
|----|--------|------|------|-----------|---------|
| G1 | High | `improved-008` 两处口径违反:APPOSITIVE(3..17)内嵌 of-短语未拆;首尾逗号(token 3、17)被成分覆盖 | `tests/fixtures/core-gold-annotations.json`;convention「名词短语后介词短语一律拆,无例外」+「总体不覆盖标点」 | 全库其余 5 处同构句(auto-gen-034/015、improved-005、doc-of-phrase-clause-1、auto-gen-008)全部拆分,唯此句不拆——复刻「三句拆三句不拆」历史病灶;评分器奖励错误口径 | 改标注为 `APPOSITIVE 4..6` + `ATTRIBUTE 7..16` + 首尾逗号退出覆盖;黄金集 replay 验证 |
| G2 | Medium | `improved-001`(`The way we build software has changed.`)限定从句整块并入 SUBJECT,全库唯一(其余 11 句含 ATTRIBUTIVE_CLAUSE 标注全部独立成句,共 12 处出现) | 同上 fixture | 同构异标;评分器惩罚做拆分的正确分析 | 二选一:拆为 `SUBJECT 0..1 + ATTRIBUTIVE_CLAUSE 2..4 + PREDICATE 5..6`(推荐,与全库一致),或 conventions 写明「way 的从句补足整体并入」 |
| G3 | Medium | 括注两种口径:`retry-008` 的 `(ADR)` 并入 SUBJECT,`improved-003` 的括注拆 APPOSITIVE | 同上 fixture | 同构异标 | 向 improved-003 对齐(`SUBJECT 0..3 + APPOSITIVE 4..6`),conventions 补一句括注口径 |
| G4 | Medium | `doc-negated-svo-1` 的 `Git for Windows` 整体作 OBJECT,与 convention「名词后介词短语一律拆」字面冲突 | 同上 fixture + conventions | 严格执行口径的模型会拆专名(`OBJECT Git + ATTRIBUTE for Windows`)而被评分器判错——口径文本与句法直觉的真实冲突 | **保留现标注**(不拆是对的),conventions 补「词汇化专名内部的介词短语不拆」 |
| G5 | Medium | `auto-gen-012` 并列表语拆出 CONJUNCTION,而并列副词按 convention 合并为一个成分——形容词并列落在口径空档 | 同上 fixture | 两种输出都合法,模型学不到口径 | conventions 明确「并列**表语**按并列谓词处理,标 CONJUNCTION」 |
| G6 | Low | `copular-3` 的 `for beginners`(enough 的补足语)拆 ADVERBIAL;挂靠歧义未定口径 | 同上 fixture | 小幅评分噪声 | conventions 注明「形容词短语内补足介词短语仍独立成 ADVERBIAL」 |
| G7 | High | of-钉住测试 `keeps every of-phrase out of the noun-phrase component it modifies` 的 `nominalRoles` 不含 APPOSITIVE——G1 现状因此不红 | `src/language/core-gold-annotations.test.ts:163-169` | 守护缺口:APPOSITIVE 内藏 of-短语不会被钉住 | `nominalRoles` 补 `APPOSITIVE`(与 G1 同一提交) |

### B. Validator(双端 13 条硬门)

| ID | 严重度 | 问题 | 证据 | 机理与后果 | 修复方向 |
|----|--------|------|------|-----------|---------|
| V1 | High | 尾介词白名单无解误杀:`of/within/between/among` 在 `OBJECT_REQUIRING_PREPOSITIONS` 中,但这四词可合法悬垂且句尾悬垂时**无解** | `analysis-validator.ts` + `AnalysisValidator.kt` 词表;例句 `That's what dreams are made of.`(PREDICATIVE_CLAUSE 尾词 of → 任何重划分必然仍以 of 收尾,修复指令「merge the phrase」无词可并,三轮全败) | 正确分析被逼进死胡同 → 整句退错误卡片 | **角色豁免(第 2 轮 D5 修正,勿整表删词)**:四词保留在白名单,仅当 `component.role ∈ 五类从句角色` 时跳过(从句内部悬垂合法:关系从句/名词性从句的介词悬垂);短语角色(ADVERBIAL/ATTRIBUTE 等)照旧拦——整表删词会丢掉 `near the frontier of` + 宾语从句被外切这族真实错误的唯一防线;双端同步 + 正反例(悬垂从句正例 + 短语角色尾 of 反例)+ 黄金集 replay;词表口径进 AGENTS/invariants |
| V2 | High | 单成分 FRAGMENT_HEAD 豁免整句门 = 整句逃逸钥匙:含完整谓语的句子整句标一个 FRAGMENT_HEAD 可通过全部门(混用门只在有第二成分时触发) | 整句门豁免 `role === FRAGMENT_HEAD`;混用门 `components.some(...)` 在单成分时为 false | 「没有划分」的退化形态被豁免重新打开;长句糊弄成一个卡片 | 单成分 FRAGMENT_HEAD 实词数上限门(上限 **10**;第 2 轮 D4 提出、第 3 轮 Z4 修正例证:原例句 UNFCCC=7 实词、TRIPS=8 实词(Trade-Related 连字符记 1 token),在 8 上限下都放行,「8 会误杀」例证失效——上限 10 的可验证依据是黄金集 G1 落地后 improved-008 的 10 实词 ATTRIBUTE 与对更长词汇化标题的余量);**作用域必须同时钉死 `components.length === 1` 与 `role === FRAGMENT_HEAD` 两个条件**(缺前者会误杀 V14 落地后「片段+定语从句」里的长 FRAGMENT_HEAD);正反例须含真实 9-10 词单成分片段(过)与 11+ 词整句糊弄(拒);上限常量进 architecture-docs 断言 |
| V3 | High | ATTRIBUTIVE_CLAUSE 后跟 COMPLEMENT 误杀:宾补结构 `We consider the movie that she directed a masterpiece.` 的正确分析被拒 | 跟随门拒绝 ATTRIBUTIVE_CLAUSE 后紧跟 OBJECT/PREDICATIVE/COMPLEMENT;注释只论证了「主句宾语在谓语后」的主语定从情形 | 定从修饰**宾语**时后面完全可以有主句补语/第二宾语 | **最小修复:仅把 COMPLEMENT 移出跟随集**(第 2 轮 D3 修正:**否决**原「按前邻是否 SUBJECT 区分」的进阶方案——历史实测错误 `ATTRIBUTIVE_CLAUSE(that will reach) OBJECT(about $650 billion)` 的前邻也是 OBJECT(它修饰前面的宾语),与前邻判据要放行的合法双宾/宾补形状局部同构,本地无判据可分);`give the teacher who helped me a book` 双宾残留误杀接受(低频);双端 + 宾补正例 + 黄金集 replay(黄金集 ATTRIBUTIVE_CLAUSE 后随仅 PREDICATE×3/ADVERBIAL×1,无 COMPLEMENT,replay 安全) |
| V4 | High | Kotlin 两个测试缺 `@Test` 注解:`rejects a CONJUNCTION…`(约 :191)与 `rejects one component covering the whole sentence…`(约 :375)——FANBOYS 门与整句门在 Kotlin 侧零执行中的测试,改坏不红 | `AnalysisValidatorTest.kt`(已亲验:两处 fun 前无注解) | 静默测试丢失 | 补两个 `@Test`;建议顺带加「词表成员数」元测试防静默改动 |
| V5 | Medium | 逗号隔断的相邻 PREDICATE 漏判:相邻门要求 `endToken + 1 === startToken`,未覆盖逗号即穿透 | 相邻门区间连续判定;CORE_OUTPUT_SHAPE 允许标点不覆盖 | 并列谓语的碎化划分本地拦不住(裸名词宾语漏判的代价只是粒度差) | **第 2 轮 D1 重设计**:原动机例句 `traces the issue, identifies…` 的黄金标注(doc-coordinate-predicate-2)本就是三个 PREDICATE(宾语隔开,不相邻,不触发)——原方案前提错误;且原方案会**误杀 conventions 明文要求的正确形状**:共享主语不及物动词串 `The system boots, runs, and shuts down cleanly.`(相邻 PREDICATE 间只有未覆盖逗号,黄金集无此形状、replay 不会红、误杀完全静默)。改为:① **放弃该门**(推荐,靠 PEER_COMPONENT_RULE 提示词约束);或 ② 收窄为「间隔内**不含逗号**才算相邻」(拦 `must close – leave` 类怪异输出,逗号串按约定放行);正反例必须含「不及物共享主语谓语串」用例 |
| V6 | Medium | ADVERBIAL/ATTRIBUTE 吞整从句漏判:`Because the road was flooded` 被标 ADVERBIAL(非 ADVERBIAL_CLAUSE)全门通过 | `SUBORDINATING_CONJUNCTIONS` 表已存在且只喂给死门 | 从句整块规则零本地兑现,卡片显示「状语」吞从句 | **第 2 轮 D2 修正词表**(原「七词绝无介词用法」论断事实错误):`because of` 是标准复合介词、`though` 有句尾副词用法,原词表两处高频误杀。修正后:`although/whereas/unless/lest/whilst` 无条件收(确无其他用法);`because` 仅当**第二个实词不是 `of`** 时收;`though` 仅当成分实词数 ≥2 时收(单实词句尾 `though` 放行);正反例必须含 `Because of this limitation, …`(正例)与 `The docs don't cover it, though.`(正例);黄金集实测无七词开头的 ADVERBIAL/ATTRIBUTE(仅 2 个 because 开头 ADVERBIAL_CLAUSE),replay 安全 |
| V7 | Medium | SUBJECT_CLAUSE 缺引导词门:`developers now play a frontline role` 被标 SUBJECT_CLAUSE 的历史实测错误现在仍拦不住(主语从句不能省引导词,宾语从句才能省 that) | 现有门无从句引导词判定 | 历史线上错误复发无防线 | **第 2 轮 D7 补全闭集**(原省略号会导致 wh-ever 系列误杀):闭集 = `{that, whether, what, whatever, which, whichever, who, whoever, whom, whomever, whose, how, why, when, where}`(刻意不收 `if`——主语从句用 if 非标准;不收 `however`——引导让步状语从句);it 形式主语不误杀(门查从句成分自己的首词,`It is obvious that…` 的从句以 that 开头,标 SUBJECT_CLAUSE/PREDICATIVE_CLAUSE 都过);闭集成员数进 architecture-docs 断言与词表元测试;黄金集仅 what/whether 两个样本,**正反例必须补 `Whoever wins gets the prize.`/`How he did it remains a mystery.` 等** |
| V8 | Medium | 纯标点成分双端判定分叉(范围收窄):TS validator 单元层报结构错误,而 Kotlin validator 预丢弃直接通过(各自测试钉死相反行为);TS 的 correction 路径(analysis-service.ts 直调 validateCoreBatch)也缺预丢弃 | TS `analysis-validator.ts` 纯标点门 vs Kotlin 预过滤;TS service 层 `dropPunctuationOnlyComponents` 已在 core 主路径(含修复轮)预丢弃,故主路径运行时后果已消解,分叉仅在 validator 单元层与 correction 路径 | 双端 validator 单元行为相反(直接调用方结果分叉);correction 路径会对纯标点成分多烧校验错误 | 把 service 层的预丢弃下沉进 validator(双端统一为「预丢弃」语义),correction 路径随之闭合;两端 validator 测试同步改;shared-fixtures 补对照向量 |
| V9 | Medium | 助动词错误文案分叉:TS 有专属文案(`auxiliary/modal verb "must" must be merged…`),Kotlin 只有通用文案;TS 侧也**无任何断言**钉住该文案(改坏不红) | TS `AUXILIARY_MODALS` 分支 vs Kotlin 无 auxiliary 实现 | 文案进 repair prompt,双端修复指令系统性偏差 | Kotlin 补 `auxiliaryModals` 集合与分支(推荐),双端各补文案断言 |
| V10 | Medium | 黄金集只在 Chrome 侧钉住 validator;IntelliJ 全仓库零黄金集回归 | `core-gold-annotations.json` 位于 chrome-plugin/tests/fixtures/;Kotlin 侧无消费 | Kotlin 新门误杀黄金句 CI 不红;「黄金集必须整份通过校验」只对 TS 生效 | 黄金集升入 `shared-fixtures/core-gold-annotations.json`(与 segmenter-vectors 同款双端消费),Kotlin 增加逐句 validateCoreBatch 测试,TS 改读 shared-fixtures |
| V11 | Low | 整数解析边界分叉:`0.0`/`1e2` TS 收 Kotlin 拒;负数文案分叉(Kotlin `must be non-negative`,TS 走区间外文案) | 双端 parseRange/整数判定 | 低频;同输入不同判定与修复文案 | **定论(第 5 轮收口):Kotlin 放宽正则接受 `\d+\.0*` 尾零形式,负数文案对齐 TS(负值走区间外文案)**;优先级最低,批次 6 |
| V12 | Low | 感叹/插入语整句单成分误杀:`What a wonderful surprise!`(4 实词)整句标 INDEPENDENT_ELEMENT 被拒且修复指令要求拆分(无处可拆) | 整句门唯一豁免 FRAGMENT_HEAD | 低频片段语义角色被拒 | **与 V2 统一实现**(第 2 轮 D6 修正,勿独立豁免两角色——不配上限就是第二把逃逸钥匙,`Fortunately, the test passed.` 整句一个 INDEPENDENT_ELEMENT 会畅通无阻):统一门 =「单成分覆盖整句且实词 ≥4 时,仅当 role ∈ {FRAGMENT_HEAD, INDEPENDENT_ELEMENT, APPOSITIVE} **且** 实词数 ≤ V2 上限时放行」——V12 成为 V2 的自然推广 |
| V13 | Low | COORDINATE_CLAUSE 死门冗余:「首词从属连词且无 CONJUNCTION」门已被「出现即拒」废弃门完全遮蔽 | 双端两门并存 | 双端多维护一份死逻辑与死文案 | 合并为一条(保留废弃门文案);纯重构,黄金集 replay 保障 |
| V14 | Medium | FRAGMENT_HEAD 混用门一刀切拒掉「片段 + 内嵌定语从句」:列表项 `An API that returns JSON responses.` 的语言学正确划分(FRAGMENT_HEAD + ATTRIBUTIVE_CLAUSE)被拒 | 混用门含五类从句角色;黄金集 5 个 fragment 前缀句(**第 5 轮核口径:4 句含 FRAGMENT_HEAD 标注 + 1 句祈使反例**)均无从句角色,口径未定义 | 模型被迫把整块标成单个大 FRAGMENT_HEAD,从句卡片丢失 | **第 2 轮 D8 收窄推荐**:混用集**只移出 `ATTRIBUTIVE_CLAUSE`**(定语从句内嵌名词短语片段是唯一语言上自洽且实测高频的组合——标题/列表项带关系从句极常见),其余四类从句照旧拒(片段无定式谓语,不存在主语/状语从句的宿主关系,放行只服务模型胡标);产品视角:整体一个 FRAGMENT_HEAD 会让从句卡片永久消失且与成句输入表现不一致;黄金集补 2-3 句「片段+定语从句」人工复核句 + 机器断言;与 V2 联动:拆出从句后 FRAGMENT_HEAD 实词数更小,上限不受影响;仍需用户裁定 |

### C. 分句/分词(segmenter)

| ID | 严重度 | 问题 | 证据 | 机理与后果 | 修复方向 |
|----|--------|------|------|-----------|---------|
| S1 | High | `etc.` 不在 43 条缩写白名单,而注释点名它是「预防性补充」(已亲验双端各 43 条、逐条同序一致,唯 `etc.` 缺席);`e.g./i.e./vs./cf.` 都在 | `segmenter.ts` ABBREVIATIONS(:42-86) + Kotlin 同构表;注释 :37 | 技术文档高频:`…, etc. in practice.` 被切成 `…, etc.` + `in practice.` **两个残句**进模型,必然划分错 | **放进 CONTEXT_SENSITIVE 类**——注意**不能**放 ALWAYS_NON_TERMINAL(该类无条件合并不看下一片大小写,放进去会让 `…, etc. In practice this works.` 误并,即 S4 病症);**实现细节(第 2 轮 D14)**:`etc.` 必须同时加进 (a) 主 ABBREVIATIONS 列表(tokenization 也吃这份表,`etc.` 从 `etc`+`.` 两 token 变单 token 且 punctuation=false——这才是「tokenization 变化、双版本同升」的真正依据)与 (b) CONTEXT_SENSITIVE_ABBREVIATIONS,双端插入位置保持同序;`…, etc. Then go.` 保留边界(两句)是想要的行为(etc. 后大写续接在英语里不成立);否决第三方案(ALWAYS_NON_TERMINAL + S4 大写例外捆绑——High 级修复不能耦合在 Low 级语义决策后面);双端同步 + 向量 + 两版本同升 |
| S2 | Medium | Kotlin `trimEnd()` 与 TS 共享 whitespace 类分叉:NBSP(U+00A0)/U+202F/U+FEFF 尾缀时 TS 剥、Kotlin 不剥;U+001C-001F 反向分叉(JVM 剥、TS 不剥);ZWSP/NEL/VT 两端行为一致不构成分叉 | Kotlin `Segmenter.kt:81` 用 JVM 全集 trim;TS 只剥共享显式类 | 双端确定性一致被破坏(网页复制文本含 NBSP 常见) | Kotlin 改为按 `javascriptWhitespace` 类手写尾部剥离(文件内已有该单字符判定);补 NBSP/U+001C 尾缀向量(ZWSP 向量另有价值:钉「两端一致当普通字符」) |
| S3 | Medium | 省略号语义:`Wait... then go.` 一分为二(`...` 在句末标点串类中) | 边界 pattern `[.!?…。！？]+` | 常见排版陷阱;残句照样进模型 | **语义决策先行**:`...` 视为停顿(合并)还是句末(现状)?先改 AGENTS/文档口径再改码;若合并需双端 + 向量 |
| S4 | Low | 强非终结类缺「大写例外」:`We met at 9 a.m. The talk was great.` 误并一句(`a.m.` 无条件合并;`Compare Fig. A. Fig. B differs.` 同型,单字母 initial 触发);原例句 `Compare Fig. 1. Fig. 2 differs.` 实测**不**误并(`1.` 非缩写非 initial,边界保留) | 白名单分类逻辑 | 低频但真实 | 把非称谓类(Fig./No./a.m./p.m./et al.)并入「可收句类」判断(下一片大写保留边界);与 AGENTS 现行约定冲突,先改约定 |
| S5 | Low | 裸版本号尾段吸收:`…required. v1.2.3.` 尾段无实词回并前句 | 尾段前向合并逻辑 | 残句拼合体进模型,句子相位与缓存键受影响 | 评估「无实词尾段丢弃」vs 现状回并;需双端一致 |
| S6 | Low | `Node.js` 拆三 token(`Node` `.` `js`)、`HTTP/2` 拆开——专有名词/技术标识未被 token 层保护 | token regex 分支 | 句级正确;token 碎片化增加模型定位难度(一般可处理) | 口径决策:是否给「字母.字母」形态加 token 保护;若改,升两条提示词版本 |
| S7 | Low | 共享向量覆盖缺口:句尾 URL/邮箱+句点、`?!`/`?"` 连用、省略号、`4.5.` 收句、`Please stop.` 反例(TS 缺)、`e.g.` 单 token(Kotlin 缺)、裸版本号尾段 | `shared-fixtures/segmenter-vectors.json`(8 组) | 两份手抄 token regex 无「源码等价」守护,只有向量里出现过的形态会红 | 按清单补向量(纯钉子,无行为变化);**其中省略号/裸版本号两项随 0c 的 D11 后移到各自语义决策批次(S3/S5),不在批次 0 补** |
| S8 | Low | 全角闭括号(`）』」`)不在收尾引号/括号类 | 边界 pattern 收尾类 | 中文站点混排时不断句 | 视目标用户群决定是否扩展字符类;需双端 |

### D. 提示词(prompt)

| ID | 严重度 | 问题 | 证据 | 机理与后果 | 修复方向 |
|----|--------|------|------|-----------|---------|
| P1 | High | PREDICATIVE_CLAUSE / SUBJECT_CLAUSE 零定义零例子(全 prompt 仅角色枚举与五角色列表中出现);ADVERBIAL_CLAUSE 只有从属连词列表无完整例句 | `prompts.ts` / `Prompts.kt` Complex-sentence rule 只给 ATTRIBUTIVE_CLAUSE 与 OBJECT_CLAUSE 各一例 | 表语从句(`The problem is that the cache is stale.`)会被标 OBJECT_CLAUSE 且**无任何 validator 门可拦**,错误直接写缓存长期显示 | Complex-sentence rule 各补一个最小例句;升 CORE_PROMPT_VERSION;黄金集补 PREDICATIVE_CLAUSE/SUBJECT_CLAUSE 句 + 角色覆盖断言 |
| P2 | High | COMPLEMENT 零定义零例子:全 prompt 无一处说什么是补语 | 同上;只在 PEER_COMPONENT_RULE 并列提及 | 宾补结构(`consider the tool essential`)与 OBJECT/PREDICATIVE 的界线全靠模型猜 | 补一句定义 + 宾补一例;黄金集补口径断言(含 COMPLEMENT 角色已有 4 句:complement-* 2 句 + doc-causative-1 + doc-adverbial-clause-2) |
| P3 | High | 「形容词+介词补足不拆」vs「名词+后置定语拆」界线缺失:黄金集 `Compatible with…` 整句一个 FRAGMENT_HEAD(不拆)vs `Support for…` 拆 FRAGMENT_HEAD+ATTRIBUTE;prompt 只写 `separable`(无判据),validator 不拦两种输出 | 黄金集 fragment-* 标注 + COMPLETENESS_FIRST_RULE 措辞 | 模型大概率把 `Compatible with…` 也拆成两块——与黄金标注矛盾,评测扣分,线上两种粒度随机 | COMPLETENESS_FIRST_RULE 补一句「形容词头的介词补足留在 FRAGMENT_HEAD 内,名词头的后置介词短语才分离」;升 CORE_PROMPT_VERSION;conventions 同步写明 |
| P4 | Medium | FRAGMENT_HEAD 与「句内非限定短语」衔接缺明示:动名词主语句(`Reading docs builds vocabulary.`)与分词状语句(`Hoping to…, the hikers left.`)可能被误标 FRAGMENT_HEAD(会被混用门拦下进修复轮,但多花请求且修复方向无例子锚定) | COMPLETENESS_FIRST_RULE 字面可套用到句内成分 | 误判成本:多 1-2 次修复请求 + 修错可能 | 规则末尾补一句「句内非限定短语保持正常角色(动名词作 SUBJECT/OBJECT、分词开头作 ADVERBIAL);FRAGMENT_HEAD 仅当整个输入不成句」+ 一例;升版本 |
| P5 | Medium | APPOSITIVE / INDEPENDENT_ELEMENT 缺典型语境:逗号包围同位语与句首插入语(Fortunately, …)零例,与 ADVERBIAL 界线无口径 | SUPPLEMENT_RULE 只在破折号/冒号语境提及 | 两种输出双端都放行,双设备叫法不一;同位语被并入前方名词短语 | 各补一例并明确界线;黄金集补机器断言 |
| P6 | Medium | repair errors 的 path 恒为 `sentences[0].components[j]`(逐句校验产物),多句修复轮 flatMap 后模型无法配对句子 | 双端 validateAndCacheCore 逐句调用 + repair flatMap | 修错句 → 该句继续失败,浪费修复配额(每块至多两轮) | 嵌入前把 path 重写为该句在 subset 中的实际索引,或 error 附 sentenceId;双端同步;**注意会改变 repair prompt 文本,需评估假服务器 detectKind 与 parity** |
| P7 | Medium | detail repair prompt(双端一致地)缺 DETAIL_OUTPUT_SHAPE 与 MINIFIED_OUTPUT——detail 首轮失败常见形态恰是形状类错误,修复轮没有正确模板可参照 | 双端 detailRepairPrompt 仅 TS 7 段/Kotlin 10 段(第 1 轮修正:原「仅 6 行」不准),且一致地缺 OUTPUT_SHAPE/MINIFIED 两段 | detail 只有一轮修复,失败即详解缺失 | 双端补两段;升 DETAIL_PROMPT_VERSION(detail prompt 变化;保守做法——repair prompt 无版本常量,见横切 2 例外说明) |
| P8 | Medium | detail repair prompt 双端标签已分叉(`Sentence and Tokens:` vs `Selected sentence:` 等)且 core/detail repair 均**零 parity 守卫**(当前 core repair 事实一致只靠人肉) | 双端 repair/detail prompt 构造 | 单端漂移不红任何测试,双端修复成功率缓慢分叉且难归因 | 统一三处标签;parity fixture 增补 repair 与 detail prompt 期望输出 |
| P9 | Medium | detail 层中文角色词表缺 表语/同位语/补语/独立成分/片段主体(DETAIL_OUTPUT_SHAPE 词表未与 17 角色对齐);detail prompt 无片段概念 | 双端 DETAIL_OUTPUT_SHAPE | 详解卡片与卡片标签叫法冲突(core 标「表语」详解写「补语」);FRAGMENT_HEAD 成分详解被描述成「主语」 | 词表补全 + 「focus 角色用与核心分析同名中文术语」一句;升 DETAIL_PROMPT_VERSION |
| P10 | Low | prompt 助动词列表与 validator 不同步(prompt 缺 been/being/having;validator 有) | 双端 PREDICATE_SCOPE_RULE vs AUXILIARY_MODALS | 罕见长动词组例子缺失 | prompt 列表补三词或改措辞「(be/have/do 的全部形式)」;升版本 |
| P11 | Low | 系动词范围未列(seem/become/turn 无例子,黄金集有 seem 口径) | PREDICATE_SCOPE_RULE 例子全是 be | 低频 | 可选补例;升版本时顺手 |
| P12 | Low | 术语不对镜:prompt「exactly one FRAGMENT_HEAD」vs validator「at most one」(判不了 0,刻意);compound 判据两处措辞不一 | 双端 prompt/validator | 不致错,增加口径理解成本 | validator 注释点明;prompt 措辞镜像化(顺手) |

### E. 运行时链路(runtime)

| ID | 严重度 | 问题 | 证据 | 机理与后果 | 修复方向 |
|----|--------|------|------|-----------|---------|
| R1 | Medium | 缓存键 normalize 的 `\s` 语义双端分叉:TS `\s`(Unicode 空白)vs Kotlin `\s`(仅 ASCII)→ 含 NBSP/U+2000 系空白的句子双端缓存键不同 | `analysis-service.ts` normalizedSentenceText vs `AnalysisService.kt` normalize;分词 regex 两端刻意用显式类,唯独此处漏了 | 跨端缓存互导(CacheTransfer)静默失效;违背「键必须双端确定性一致」 | Kotlin 复用 `jsWhitespaceClass`(第 2 轮 D12:该常量现为 Segmenter.kt private,应提为 internal 共享,**勿在 AnalysisService 手写第三份字符类**——否则重蹈「两份手抄 regex」覆辙);测试向量应针对**句内**空白(`The\u00A0service works`)而非尾缀(segmentBlock 已用 JS 类 trim,尾缀用例测不到分叉);shared-fixtures 补含 NBSP 的缓存键向量 |
| R2 | Low | 流式尾部点击成分 → core 完整响应重渲染删掉已打开详解面板 → detail 响应到达时静默丢弃(用户感知「面板闪没」) | `learning-block.ts` section 重渲染删 `.detail` + `renderDetail` 找不到面板即 return | 非错误划分(detail 有 focus 严格校验),体验缺陷 | 重渲染前检查在飞 detail 请求,迁移/重开 loading 面板 |
| R3 | Low | (= P6 同源,运行时视角)repair path 索引与 Invalid JSON 子集的数组索引可能不对应 | 同 P6 | 同 P6 | 同 P6 |
| R4 | Low | Chrome 纯缓存分支(cacheOnly/profile undefined)返回未经 sanitizeCore 的缓存值 | `service-worker.ts` lookupCore 直返 | 安全面瑕疵(缓存可能来自有 key 时期),不影响划分 | cacheOnly 分支套空 secrets 脱敏,或写缓存前脱敏(键不含 profile,不破坏命中) |
| R5 | Low | 流式分片 translation 缺省策略双端不一致:TS 缺省 `""` 并接受,Kotlin null 整片拒绝 | 双端 ProvisionalComponents.accept | 同一模型行为双端渲染分叉(空译文行 vs 丢分片) | 对齐一侧(建议对齐 TS 渐进增强语义) |
| R6 | Low | `bundle.js` 是提交的构建产物,角色色板/标签与 `roles.ts`/`grammar.ts` 的守护**只钉 FRAGMENT_HEAD 单角色**(bootstrap-lifecycle.test.ts 断言其标签与双色),17 角色非全量对齐 | web bundle 内嵌 ROLE_COLORS/GRAMMAR_LABELS;bootstrap-lifecycle.test.ts:59-67 | 忘重建 → IntelliJ 端旧映射(未守护的 16 个角色漂移不红) | 把单角色断言扩为全量同源比对(与 grammar.ts/roles.ts 逐值);或 bundle 移出 git 由 Gradle 构建 |
| R7 | Info | Kotlin `SentencePhase.STALE` 死枚举;IntelliJ「块文本变化」防线依赖「官方预览整体重写 DOM + blockId 单调计数」隐性组合,无单一测试钉住 | `PreviewSession.kt`;Chrome 侧有 invalidateBlock 对应物 | 若未来出现局部 DOM 更新保留原元素,将既不重析也不报错(卡片消失,非错划分) | sentenceId 掺入 normalizedText 哈希(与 Chrome 对齐)或实现 invalidate 语义;至少加守护测试 |
| R8 | Info | SW 路径 `requestModel` 的 AbortSignal 永不触发(取消实际靠 cancelDocument),abort→cancelDocument 监听在生产路径形同虚设 | `service-worker.ts` 各处 `new AbortController().signal` | 代码误导性;测试若依赖 signal 路径会与生产不符 | 注释说明或接线真信号;低优先 |

## 2. 修复批次计划

原则:每批独立可合并、可验证;凡动 prompt/validator 必双端逐字同步;凡动 tokenization 必双端 + 向量 + **两条提示词版本同升**;凡新门必黄金集整份 replay + 正反例;凡改口径必「prompt 规则、conventions、黄金标注」三处同改。

### 批次 0:数据与钉子(零行为变化,先行)

| 项 | 内容 | 验证 |
|----|------|------|
| 0a | G1 修 improved-008 标注 + G7 nominalRoles 补 APPOSITIVE(同一提交) | `npm test`(黄金集测试 + replay) |
| 0b | V4 补两个 `@Test` + 词表成员数元测试(第 2 轮补充:元测试须覆盖 Kotlin 侧全部词表;**第 5 轮补基线**:AnalysisValidator.kt 现有 6 张字符串词表——coordinatingConjunctions 7、prepositions 15、subjectPronouns 7、determiners 13、subordinatingConjunctions 21、objectRequiringPrepositions 11,另有 6 个键集与 3 个角色集(clauseRoles 5/fragmentClauseRoles 11/clauseInternalFollowers 3)由执行者决定是否纳入;5b 落地时 auxiliaryModals 以 TS 侧(15+ 成员)为基准增量登记) | `gradlew :intellij-plugin:test` |
| 0c | S7 补共享向量清单(句尾 URL/邮箱、`?!`、`4.5.`、`Please stop.`、`e.g.`);**第 5 轮补落点**:优先加进共享 `segmenter-vectors.json`(双端遍历向量、自动同测),双端各自单测仅在有端侧行为差异断言时才补;**第 2 轮 D11:裸版本号尾段向量后移到 S5 决策批次,省略号向量若补也与 S3 决策同批——避免钉住即将废弃的行为** | 双端 segmenter 测试 |
| 0d | **V10 前移(第 2 轮 D9:黄金集双端消费是批次 1/3 全部 validator 改动的安全网,不能等批次 5)**:黄金集搬入 `shared-fixtures/core-gold-annotations.json`,Kotlin 增逐句 validateCoreBatch 测试(FixtureLoader 已有 shared-fixtures 定位模式,无需 gradle 资源配置),TS 改读 shared-fixtures;**第 4 轮补三项**:(a) 把 `src/language/core-gold-annotations.test.ts` 加入 `npm run test:contracts` 清单(与 segmenter.test.ts 同款契约 job 待遇,否则 CI contracts job 对新共享 fixture 零覆盖);(b) 同步改文档旧路径引用 `docs/architecture/modules.md:129` 与 `build-test-release.md:73`(docs:drift 盯不到 shared-fixtures 搬家,必漏);(c) 同步改 `.superpowers/acceptance/run-core-gold-evaluation.mjs:21` 的硬编码旧路径(脚本 gitignored,CI 不会提醒) | 双端门禁全绿 + CI contracts job 覆盖黄金集;手动评测脚本路径可用 |

### 批次 1:无解误杀修复(validator,黄金集 replay 保障)

> 第 2 轮 D10 结论(写明防止重问):**本批不需升任何 PROMPT_VERSION,是结构性事实**——`CORE_PROMPT_VERSION` 只进缓存键、身份化 `buildCorePrompt` 产物;repair prompt 的校验错误是逐次请求的动态载荷,不进缓存、无版本常量管辖。新门落地后旧缓存读回时重过 validator,违背新门的条目自动判无效当 miss 重取,不会旧坏结果长期显示。需要做的是每条新门文案双端逐字一致 + 单测钉死(V4 死测试正是缺钉子的下场);detectKind 只匹配首行,本批不动首行,E2E 安全;**第 4 轮补**:playwright 全量绿同时意味着假服务器 auto 响应(SUBJECT+OBJECT 两成分)未被新门误伤(E2E 断言 repair 计数为 0,新门误伤 auto 形状会以 fetch 计数断言红,可检测)。

| 项 | 内容 | 约束 |
|----|------|------|
| 1a | V1:**角色豁免版**(四词保留白名单,仅从句角色跳过——勿整表删词,理由见 V1 条目) | 双端 + 正反例(悬垂从句正例 `That's what dreams are made of.` + 短语角色尾 of 反例 `near the frontier of` 被外切族)+ 黄金集双端 replay;词表口径进 AGENTS/invariants |
| 1b | V3:ATTRIBUTIVE_CLAUSE 跟随门**最小修复**(仅 COMPLEMENT 移出;否决前邻判据进阶方案,理由见 V3 条目) | 双端 + 宾补正例 + 黄金集 replay |
| 1c | **V2+V12 统一门(第 3 轮 Z5 合并:两轮各自落笔导致批次 1 与批次 6 头注各说半句)**:单成分覆盖整句且实词 ≥4 时,仅当 `role ∈ {FRAGMENT_HEAD, INDEPENDENT_ELEMENT, APPOSITIVE}` **且**实词数 ≤10 时放行;作用域同时钉死 `components.length === 1` 与角色条件 | 双端 + 正反例 + 黄金集双端 replay;上限常量与豁免角色集进 architecture-docs 断言;豁免集含 APPOSITIVE 的论证:同位语整句出现即同位罗列片段,与 INDEPENDENT_ELEMENT 同为「片段语义角色」,无「划分退化」风险(口径决策,进横切 7 裁定清单)。**第 5 轮阻断 2 补例句约束**:9-10 词单成分正例**不得含可拆的后置介词短语结构**(否则与 4c/P3「名词头的后置介词短语才分离」口径打架,两边测试各测各的谁都不红)——用无介词的词汇化名词堆叠/形容词并列形态(如 9-10 实词的产品名或标题),优先从真实文档标题选,需人工核语言学正确性;11+ 词反例任意成句即可;反例(`What a wonderful surprise!` 过)保留 |
| 1d | V8:service 层预丢弃**下沉进 validator**(双端统一「预丢弃」语义,correction 路径随之闭合;勿按旧方案「移植 Kotlin 预丢弃到 TS」——TS service 层已有) | 双端 validator 测试同步改;shared-fixtures 补对照向量 |

### 批次 2:tokenization 修复(升 CORE 11→12 与 DETAIL 5→6)

| 项 | 内容 | 约束 |
|----|------|------|
| 2a | S1:`etc.` 同时加进主 ABBREVIATIONS 与 CONTEXT_SENSITIVE 两张表(双端同序;实现细节见 S1 条目) | 双端 + 向量(句中合并/收句保留两态)+ 两版本同升 + AGENTS 版本号同步;**第 2 轮 D10 补充:双版本同升 = 全量 core+detail 缓存作废(键变),用户侧表现为全量重取——预期行为,验收时勿误判为回归** |
| 2b | S2:Kotlin trimEnd 改共享类剥离 | 双端 + NBSP/U+001C 尾缀向量;无 token 边界变化(仅分句),但与 2a 同批升版本 |

### 批次 3:漏判补门(validator;第 2 轮裁定:**本批三项均需先按 D1/D2/D7 修订方案才可执行**)

| 项 | 内容 | 约束 |
|----|------|------|
| 3a | V5:**先在「放弃该门」与「无逗号间隔才算相邻」间裁定**(原「纯标点间隔视为相邻」方案已否决——会误杀 conventions 明文的不及物谓语串,见 V5 条目) | 若保留门:双端 + 正反例必含 `The system boots, runs, and shuts down cleanly.`(须过);黄金集 replay |
| 3b | V6:修正词表版(`although/whereas/unless/lest/whilst` 无条件;`because` 第二实词非 of;`though` 实词数 ≥2) | 双端 + 正反例必含 `Because of this limitation, …` 与 `The docs don't cover it, though.`(均须过);黄金集 replay;词表进 0b 元测试 |
| 3c | V7:SUBJECT_CLAUSE 引导词闭集门(闭集 15 词见 V7 条目) | 双端 + 正反例必含 `Whoever wins…`/`How he did it…`(须过)与 `developers now play…`(须拒);黄金集 replay;闭集成员数进 architecture-docs 断言 |

### 批次 4:提示词补真空(升 CORE 12→13;P7/P9 升 DETAIL 6→7)

> 排序说明(第 3 轮 B1 补):P1-P3 虽为 High,但排在批次 4 是刻意的——批次 0-3 先行夯实 validator 安全网与黄金集双端 replay 基建(新口径没有守护就上线,错例句会直接写缓存),且版本升级按批合并(批次 2 已升一次 core,prompt 改动并入批次 4 再升一次,避免每批作废缓存)。

| 项 | 内容 | 约束 |
|----|------|------|
| 4a | P1:三从句例句(PREDICATIVE/SUBJECT/ADVERBIAL_CLAUSE 各一;**第 5 轮补例句源**:ADVERBIAL_CLAUSE 复用 V6 条目的 `Because the road was flooded, …`,SUBJECT_CLAUSE 复用 V7 的 `Whoever wins gets the prize.`/`How he did it remains a mystery.`;**新增黄金句须人工核语言学正确性并补机器口径断言——AGENTS 硬性要求,黄金集曾有 32 句自动标注混入 15 处错标的前科**) | 双端 + parity fixture 更新(**第 5 轮补:无现成重生成脚本**——临时 node 脚本调 `buildCorePrompt` 输出后手工更新 `core-prompt-parity.json` 的 prompt 字段与版本字段,双端测试互验)+ 黄金集补句与角色断言 |
| 4b | P2:COMPLEMENT 定义 + 宾补一例 | 同上;黄金集含 COMPLEMENT 角色共 4 句(complement-* 2 句 + doc-causative-1 + doc-adverbial-clause-2),可加机器断言 |
| 4c | P3:形容词补足界线一句 + 例 | 同上 + conventions 同步;G5 顺带 |
| 4d | P4:句内非限定短语一句 + 例 | 同上 |
| 4e | P5:APPOSITIVE/INDEPENDENT_ELEMENT 各一例 + 界线 | 同上 |
| 4f | P7+P9:detail repair 补 OUTPUT_SHAPE/MINIFIED;detail 角色词表补全 | 升 DETAIL 版本;双端 |
| 4g | P8:repair/detail parity 守卫;P6/R3:repair path 重写(第 2 轮 D13 实测:既有 prompts.test 的 6 处 path 断言均为显式传入 errors,不破坏;path 重写不升版本——repair prompt 无版本常量;**必须与 P8 同批**——parity fixture 先钉旧格式就翻车)| parity fixture 增补;detectKind 回归 |

### 批次 5:黄金集口径统一与双端对齐

| 项 | 内容 | 约束 |
|----|------|------|
| 5a | G2(improved-001 拆分)+ G3(retry-008 对齐)+ G4(专名不拆写进 conventions)+ G6(conventions 补口径);**G5 已随 4c 落地(第 3 轮 Z6 去重,P3 本就要动 conventions),此处不再排** | 黄金集人工复核;replay(0d 后双端) |
| 5b | V9:Kotlin 补助动词分支 + 双端断言 | 文案以 TS 为准 |
| 5c | R1:Kotlin normalize 复用共享 whitespace 常量(勿手写第三份)+ 句内 NBSP 缓存键向量 | 双端;CacheKeysTest |
| 5d | R5:流式分片 translation 缺省对齐 | 双端 |
| 5e | V14:按 D8 推荐收窄(混用集只移出 ATTRIBUTIVE_CLAUSE)+ 黄金集补「片段+定语从句」句 | 需用户裁定确认(原编号 5f,第 3 轮 Z7 重排——V10 前移 0d 后的断号) |

### 批次 6:低危卫生(可延后;V12 除外——见批次 1 的 V2 统一门,V12 随 1c 一起落地)

V11、V13、S3/S4/S5/S6/S8(语义决策类先改 AGENTS 口径)、P10/P11/P12、R2、R4、R6、R7、R8。

## 3. 横切约束(所有批次通用)

1. **双端逐字同步**:validator 错误文案、prompt 规则文本、词表成员——TS/Kotlin + contracts.json/parity fixture 四处一致。
2. **版本升级矩阵**:动 core prompt 规则/例子 → `CORE_PROMPT_VERSION`+1;动 detail prompt → `DETAIL_PROMPT_VERSION`+1;动 tokenization(含分句白名单)→ **两条同升**。每批只升一次,批内多项合并。**例外(第 3 轮 Z8 补写,与批次 1 的 D10 结论对齐)**:版本常量只身份化 `build*Prompt` 的产物;repair/correction prompt 是逐次请求的动态载荷,**改其文本不升任何版本**——批次 1(新门错误文案进 repair prompt)与 4g(path 重写)据此不升;4f(P7 改 detail repair prompt)升 DETAIL 版本是保守做法(同批 4f 还改 detail 首轮 prompt 词表,顺势合并),非结构性必需。**同步点清单(第 4 轮补)**:升版本 = 同步改四处——`chrome-plugin/src/shared/versions.ts`、`intellij-plugin/.../domain/Domain.kt`、`shared-fixtures/contracts.json`、`shared-fixtures/core-prompt-parity.json` 的版本字段(**陷阱**:批次 2 只改 tokenization 时 parity 的 prompt 文本逐字不变,但版本字段必须单独 bump,漏改会被 cross-platform-contract/SharedContractTest 拦下);parity 的 prompt 文本仅在批次 4 重生成。architecture-docs.test 不钉两个 PROMPT_VERSION,文档同步全靠横切 5。
3. **黄金集 replay**:每条新门/改门后整份 86 句过双端 validator;新硬门把正确答案判非法比漏判更糟。
4. **假服务器回归**:凡改 prompt 首行/骨架,跑 `npx playwright test` 确认 detectKind 不破。**第 4 轮扩(mid-prompt 标记)**:fake server 还依赖两处非首行标记——`Focus:`/`Focus range:` 标签(`parseFocus` 用正则抓取,标签改形会**静默回落 {0,0}** 导致 detail 校验失败、E2E 以「详解缺失」形态红,难归因)与 `Requested focus ranges:` 字面量;凡动 detail/sentence-details/repair prompt 的段落标签(4f/4g),保持这两个标记原文不变并跑 playwright 全量。
5. **文档同步**:validator 门数/词表/版本号进 AGENTS.md 与 docs/architecture(protocol/model-pipeline/invariants/modules/**overview**——第 4 轮补:「十三条硬门」计数措辞共六处,含 overview.md:124,drift 盯不到它);`npm run docs:drift`。批次 2a 特有:AGENTS.md:45 与 invariants.md:131、overview.md:105/195 的可收句缩写六词枚举须加入 `etc.`(并注明属可收句类而非强非终结类)。
6. **门禁**:每批跑双端全量门禁(chrome: npm test + playwright + lint + format + build;intellij: npm test + gradle test + buildPlugin + verifyPluginProjectConfiguration)。
7. **裁定待决**(需用户拍板,不阻塞批次 0-2;**第 3 轮 O3 补时点:各项最迟于其所属批次启动前拍板**——V5/V6 于批次 3 前、V14 于批次 5 前、V12 豁免角色集(1c 已给论证)于批次 1 前、S3-S6 于批次 6 前,避免批次停摆等裁定):V14 口径方向(D8 已给推荐:只放行 ATTRIBUTIVE_CLAUSE,待确认);V5 门去留(放弃 vs 无逗号收窄);V12 豁免角色集 {FRAGMENT_HEAD, INDEPENDENT_ELEMENT, APPOSITIVE}(1c 已给论证,确认即可);S3 省略号语义;S4 非称谓缩写大写例外(与 AGENTS 现行约定冲突);S6 专有名词 token 保护。
8. **审阅修订记录**:第 1 轮(事实核查)修正 S4 例句/S1 方案/V8 范围/R6 守护/P2 计数等 10 处;第 2 轮(方案合理性,D1-D14)重设计 V5、修正 V1/V2/V3/V6/V7/V12/V14 方案、V10 前移批次 0、确立「validator 批次不升 prompt 版本」结论、S1 两张表实现细节、R1 常量复用;第 3 轮(完整性与一致性,Z1-Z13/O1-O5)修正增量编辑残留(V2 例证实词数 7/8 非 8/10、P2/P7 正文回写、1c 合并为 V2+V12 统一门、G5 去重、5e 断号重排、横切 2 补 repair-prompt 版本例外),并补真模型评测与发布节奏安排(见 9/10);第 4 轮(双端约束与流程)补 0d 的 test:contracts 登记/文档路径、版本四文件同步点、假服务器 mid-prompt 标记(Focus:/Requested focus ranges:)、缩写枚举文档同步、overview.md 门数措辞、auto 响应提醒,并确认协议三层/流式三处/调度器/三条硬不变量/lint 基线均不被触碰;第 5 轮(可执行性终审)修 2 个阻断项(横切 9 时态误导、1c 正例句来源与口径陷阱)并收口 0b 词表基线/0c 落点/4a 例句源与 parity 方式/V14 计数口径/V11 定论/baseline 可比性。
9. **已否决方案一览**(防止后人翻案,各条详见对应条目):V1 整表删词→改角色豁免;V3 前邻 SUBJECT 判据→仅移出 COMPLEMENT;V5 纯标点间隔视为相邻→放弃或无逗号收窄(待裁定);V12 独立豁免两角色→并入 V2 统一门;V14 剔除全部五类从句→只放行 ATTRIBUTIVE_CLAUSE;S1 放 ALWAYS_NON_TERMINAL/与 S4 捆绑→进 CONTEXT_SENSITIVE 两张表;V8 移植 Kotlin 预丢弃到 TS→service 层预丢弃下沉进 validator;P7 升版本→降为保守可选(横切 2 例外)。
10. **真模型评测(第 3 轮 O1 补)**:批次 4 落地后与全部批次完成后各跑一次 `.superpowers/acceptance/run-core-gold-evaluation.mjs` 真模型评测,对比 exact/span F1 分数——黄金集 replay 只证「结构合法」,批次 4 改的恰是模型可见文本,唯真模型评测能回应「划分变准」。**第 5 轮补三点**:(a) 脚本路径仍指向旧位置,**0d 落地时须按 0d(c) 同步改**,且该脚本 gitignored、不入库——每个执行环境需各自修改,换机器 clone 后会丢;(b) 0a 改标注 + 4a/4b/5e 补句后黄金集从 86 句增长到 ~89-92 句,**与现有 86 句旧 baseline 的总分不可直接对比**——批次 4 前先重跑一次现状基线留档,补句批次落地后按同句集或逐句 diff 对比,不得直接比旧总分;(c) 脚本不进 CI、手动运行。
11. **发布节奏(第 3 轮 O2 补)**:批次 2(core 11→12)与批次 4(core 12→13)各作废一次全量缓存;建议合并为一次版本发布(如 1.4.0),CHANGELOG 记录两次作废与 etc. 分句行为变化,验收清单包含「全量重取为预期行为」。

## 4. 调查覆盖面与置信度

- 已亲验(最高置信):V4(死测试,行号精确 :191/:375)、S1(etc. 缺席)、G7(nominalRoles)、黄金集 86 句/14 条 conventions、AGENTS 版本号已同步 core 11;第 1 轮审阅(独立复核,行为级实测)进一步确认:V1-V3/V5-V7/V9-V14、G1/G3-G6、S1/S3/S5-S7、P1/P3/P5-P12、R1/R2/R4/R5/R7/R8 全部成立,并修正 5 处事实错误(S4 例句、S1 修复方案、V8 范围、R6 守护现状、P2 计数)与 4 处细节(关系从句计数 9→11、S2 分叉字符集、P7 行数、gradle 任务名——第 3 轮 Z10 核对:第 5 项「V2 上限 8」已并入第 2 轮 D4 的方案修正,不属细节修正,故实为 4 处)。
- 双端代码逐字比对(高置信):validator 13 门逻辑与文案、core prompt 六大规则段、缓存键构造、流式过滤条件。
- 语言学判断(中置信,动手前需 replay/人工复核):G1-G6 标注修改建议、V1/V3 误杀例句、V2+V12 统一门的实词上限(现推荐 10,正反例落地时以实测为准)。
- 子代理报告中被剔除/修正的细节:黄金集 conventions 数(报 16,实为 14);P7「仅 6 行」(实为 TS 7 段/Kotlin 10 段,结论不变)。
