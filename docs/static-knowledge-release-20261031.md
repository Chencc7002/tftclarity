# 静态知识向量发布修复交付（2026-10-31）

## 状态

2026-10-31 20:19（北京时间）已部署；2026-11-01 再次只读核验通过。
S18 的 349 条知识（347 条补丁、2 条人工知识）全部拥有 bge-m3 / 1024 维向量。
现网 staticKnowledgeMode=published，健康检查 missingEmbeddings=0、
incompatibleEmbeddings=0、sourceMismatches=0、healthy=true，currentPatch=18.5。
此前 SSH 在本机 TUN/全局代理路径上间歇握手超时；显式本机 HTTP 代理曾成功，
后通过 SSH 绑定物理 WLAN 地址恢复连接，未修改全局代理或路由设置。

## 发布候选

隔离分支 codex/static-knowledge-release-20261031，基线 dd2414f。
目录 .cache/static-knowledge-release-20261031。
该基线的生成器保留 347 条公告记录和既有 2 条人工知识，包括 18.5 热补丁。
主工作区只到 18.3，且有大量无关改动，不能直接部署。仅同步本次局部实现到主工作区。
生产 checkout HEAD=259ccbc，存在此前公告/会话修复的未提交改动。
已核对本次涉及文件与运行镜像、dd2414f 基线一致（比较时统一 LF）。
实际发布以当前运行镜像为基础叠加本次文件，保留其他现网修改，未直接部署主工作区。

## 实现

- 增量构建在内存候选执行：缺失/正文改变/模型改变/损坏向量才计算，metadata-only 复用。
- 用实际 Float32 存储精度审计模型、维度、非有限和零向量。
- 一个 SQLite 事务发布正文、向量、撤销的自有记录和元数据；期间原记录变化则拒绝。
- 构建器按 season+ID 匹配，按赛季清理；通用 audit 不再默认漏掉 S18。
- 修正 SQLite upsert 仅凭模型名和向量存在就跳过的判断，允许修复同模型坏向量。
- legacy/shadow/published 启动开关；published 不再启动覆盖静态知识，报告源文件与索引差异。
- 混合检索保留；公开状态增加实际向量候选、无向量候选、provider 错误和最终结果计数。
- 可选 Compose override 在 app 启动前执行 bge-m3 / 1024 维向量发布门禁。
- 固定跨版本问题的真实检索脚本已准备，未执行，不能声明真实召回或回答效果已通过。

## 验证

Node 24.18.0，使用仓库两个 CI lane 的相同入口：

- 最终主回归（加入候选向量复用）：1691 total，1684 pass，0 fail，7 skipped。
- 最终集成：239 total，238 pass，0 fail，1 skipped。
- Agent offline：50/50，无网络模型调用。
- 新增 8 个发布/存储/观测测试纳入上述回归，覆盖 shadow、增量、隔离、坏维度修复、
  元数据复用、Float32 溢出拒绝、失败保留、并发拒绝、SQL 回滚、启动只读。
- Compose 合并配置解析、diff --check 通过；服务器候选镜像内 8 个专项全部通过。
- 测试报告位于候选 .cache/static-knowledge-main-cached.xml、
  .cache/static-knowledge-integration-final.xml、.cache/eval/agent-eval.json。

主工作区另跑回归：正常权限主回归 2340 pass / 7 fail / 7 skipped；
失败集中于旧公告、README、赛季和 UI 断言，未修改这些无关测试。
主工作区集成 238 pass / 0 fail / 1 skipped，Agent offline 50/50。
初次沙箱测试还出现本机端口 EACCES、临时文件 EPERM，已用正常权限重跑区分。

## 现网验收与回滚

备份目录：/root/tftclarity/backups/static-knowledge-20261031。
含一致性 SQLite 备份 semantic-index-final-backup.sqlite、旧源文件压缩包、
配置副本、容器身份和候选/生产构建及检索报告。配置副本含 secret，不公开复制。
旧镜像：tftclarity-app:pre-static-knowledge-20261031。
当前镜像：tftclarity-app:static-knowledge-20261031。
候选 Dockerfile 以旧运行镜像为基础，仅覆盖本次文件；未清理旧镜像或备份。

先对独立候选数据库生成 349 条真实向量并审计，再检查 18.5/18.3 绯红印记树怪、
18.1 阿狸的纯向量与混合召回：3/3 成功，向量候选 3 次，provider 错误 0。
正式发布前 shadow 再审计全部 349 条候选缓存，之后事务写入正式索引。
相同发布重复执行 embedded=0、unchanged=349。候选缓存只在 ID、赛季、正文、
内容哈希、模型和维度均匹配时复用；元数据来自当前源文件，最终仍重新审计。

正式库再次执行上述 3 个检索用例全部通过。注册 semantic_search handler 另行实测：
vectorCandidateSearches=1、vectorResultSearches=1、noVectorCandidates=0、embeddingErrors=0。
这些是独立验收进程计数，不会增加 Web 进程的 runtime 累计计数。
真实 HTTP 聊天“18.1 热补丁阿狸改了什么”完成，引用 patch_facts，回答
450/675% → 425/640%，该用例验证补丁问答，不能当作模型必然选择向量工具的证明。

额外自由问法“同一套出装出现两个帽子，能不能确定玩家有某个强化”仍返回
insufficient_evidence，没有形成知识证据；Web 检索计数未增加。此项未当作成功，
未据此放宽工具/证据校验，也未在本次修改模型路由；任意问法的工具选择仍需另行评估。

S17 的 588 条记录全字段与备份一致；S18 无删除，正文、ID、类型、版本、来源和
内容/记录哈希一致。仅 18.1 概览 metadata.generatedAt 更新，不是公告内容被覆盖。
上线切换只有 app 容器身份变化，其他运行中服务容器保持原身份；无业务库迁移。

服务器安装 compose.override.yaml 自动启用 published 和 knowledge-release 发布依赖，
普通 docker compose up 会执行对应门禁。显式 -f compose.yaml 会跳过自动 override，
维护者应使用包含 override 的合并配置。相关源文件已同步服务器 checkout，便于后续构建。
精确回滚须恢复旧镜像、源文件和原 Compose 配置；如需回滚索引，在停 app 后恢复
一致性备份，先核对备份后其他入库任务。通用流程见 static-knowledge-publication.md。
