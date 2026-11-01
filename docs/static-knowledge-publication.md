# 静态知识向量发布

补丁/人工知识复用现有 SemanticDocumentStore、buildSemanticIndex 和混合检索。
本次不改变注册工具、Evidence 校验、Quick Task、ReAct 或动态知识入库权限。

## 当前缺口与迁移

旧启动逻辑直接 upsert 文本，新增文档无向量，正文改变还会清空旧向量。
原构建器/audit 的默认 list 只看到 S17；本次显式读取所有赛季，并以赛季+ID
匹配向量、按赛季清理，防止 S18 重复计算或清理错误。
旧 deploy-v2.md 已要求部署时构建，但实际公告发布记录仍依赖启动写入。
主工作区公告当前到 18.3，不能用它覆盖现网 18.5：应在现网版本的隔离工作树
移植本次实现，使用该版本完整公告生成器构建；不能直接部署主工作区。

## 入口与保证

Node 24，使用内部 embedding 服务；不要把索引正文临时发送给公网 provider。
CLI 必须显式指定 season 和 mode，未知/重复参数拒绝。只拥有指定赛季/语言的
riot_games patch_note 和 user_maintained_knowledge static_game_knowledge。
不删除其他赛季、视频、机制、实时统计或描述文档。

```sh
node scripts/publish-static-knowledge.mjs --season=set18-live --mode=audit
node scripts/publish-static-knowledge.mjs --season=set18-live --mode=shadow
node scripts/publish-static-knowledge.mjs --season=set18-live --mode=publish
```

shadow 在内存准备和审计候选，不发布正文或向量。publish 同样先准备全部向量，
审计模型/维度/缺失/非有限值/零向量，然后 BEGIN IMMEDIATE，核对构建期间原记录
未变化，在一个事务内写入完整内容+向量、移除已撤销的自有文档并记录发布元数据。
失败回滚，原可用记录保留。正常重复发布 embedded=0；只有新文档、正文改变、
模型改变或向量不合格时重新计算。metadata 变化更新记录但复用向量。
默认 batch=4、维护任务 timeout=120000ms；不改线上问答超时。
已在独立候选库生成向量时，可以传
`--vector-cache-db=/app/.cache/semantic-candidate-20261031.sqlite` 复用已准备向量，
减少正式发布的重复计算。只接受相同源正文/内容哈希/身份/模型/维度的向量，
元数据仍取当前发布源，缺失缓存才调用 provider，最终候选全部重新审计。

## 发布接入

先在与生产一致的隔离候选上跑测试，备份生产 SQLite（含 WAL 的一致性备份），
保留旧镜像；执行 shadow 和固定问题向量/混合召回检查。通过后用 opt-in override
作为正式发布门禁，它会先完成知识构建，再启动 app；构建失败不启动新版 app。

```sh
export TFT_STATIC_RELEASE_SEASON=set18-live
docker compose -f compose.yaml -f deploy/compose.static-knowledge.yaml build app knowledge-release
docker compose -f compose.yaml -f deploy/compose.static-knowledge.yaml run --rm knowledge-release \
  node scripts/publish-static-knowledge.mjs --season=set18-live --mode=shadow
docker compose -f compose.yaml -f deploy/compose.static-knowledge.yaml up -d app
```

热补丁也必须从含新公告的候选镜像发布，沿用此流程。只需重建知识时可显式
run --rm knowledge-release，但发布后要重启 app 刷新启动健康快照。
`/api/runtime.semanticIndex.staticKnowledgeHealth.checkedAt` 是启动检查时间，
不是持续实时审计；新 CLI audit 可随时检查当前数据库和当前源文档是否匹配。

`TFT_AGENT_STATIC_KNOWLEDGE_MODE`：legacy 默认兼容旧启动同步；shadow 保留同步并
报告健康；published 禁止启动写入这些静态知识，只读取已发布版本并检查。
先 shadow 再 published，后者健康不合格时报告 degraded，仍可提供旧内容/词法检索。
回滚可去掉 override 恢复 legacy（会恢复旧启动写入行为）；若需精确恢复原公告/
向量，停 app 后恢复一致性索引备份，再用旧镜像启动。动态导入期间恢复整个库需
额外核对备份后的动态记录，不能盲目覆盖。

## 观察与验收

- enabled/model 只说明配置，不代表 embedding 服务健康或语料向量完整。
- staticKnowledgeHealth 区分 missingEmbeddings、incompatibleEmbeddings、sourceMismatches。
- retrieval 区分 vectorCandidateSearches、noVectorCandidates、embeddingErrors，及最终
  vectorResultSearches/lexicalOnlySearches/emptySearches；计数为本进程累计，重启归零。
- 精确实体/版本关键词继续参与正常混合重排；lexicalOnly 并不自动代表服务故障。
- 真实召回需检查指定版本、实体、来源和 vector candidates；不能把向量完整等同回答准确。

准备好候选索引后，可在内部网络运行
`node scripts/smoke-static-knowledge.mjs --live`。该脚本仅接受内部 embedding 主机的
bge-m3，分别检查 18.5/18.3 绯红印记树怪、18.1 阿狸的纯向量候选与混合召回。
它不调用生成模型，结果只能证明检索链路，不能证明答案准确率。

专项测试覆盖失败不覆盖、事务回滚、并发更新拒绝、跨赛季同ID隔离、重复构建零计算、
发布模式启动不改正文/向量、混合检索与故障计数。上线状态另记，代码完成不代表已上线。
