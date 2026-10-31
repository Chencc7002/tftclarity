# 静态知识向量发布修复交付（2026-10-31）

## 状态

实现完成，未部署。未执行生产 S18 向量回填、真实 bge-m3 召回验收或应用切换。
生产 HTTP runtime 可读，currentPatch=18.5，embedding 配置为 bge-m3。
SSH 域名与已记录 IP 均超时；公共 DNS 确认 A=43.155.239.228。
最后诊断 TCP 已连接，但在 banner exchange 超时，尚未进入认证阶段；
不能据此认定密码/密钥失效，也不能确定是服务器 SSH 服务还是中间网络导致。

## 发布候选

隔离分支 codex/static-knowledge-release-20261031，基线 dd2414f。
目录 .cache/static-knowledge-release-20261031。
该基线的生成器保留 347 条公告记录和既有 2 条人工知识，包括 18.5 热补丁。
主工作区只到 18.3，且有大量无关改动，不能直接部署。仅同步本次局部实现到主工作区。
上线前仍须读取服务器实际 SHA，确认与候选基线关系，避免回退其他生产更新。

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

- 最终主回归：1690 total，1683 pass，0 fail，7 skipped。
- 最终集成：239 total，238 pass，0 fail，1 skipped。
- Agent offline：50/50，无网络模型调用。
- 新增 7 个发布/存储/观测测试纳入上述回归，覆盖 shadow、增量、隔离、坏维度修复、
  元数据复用、Float32 溢出拒绝、失败保留、并发拒绝、SQL 回滚、启动只读。
- Compose 合并配置解析、diff --check 通过；本机 Docker daemon 未运行，未做容器实跑。
- 测试报告位于候选 .cache/static-knowledge-main-final.xml、
  .cache/static-knowledge-integration-final.xml、.cache/eval/agent-eval.json。

主工作区另跑回归：正常权限主回归 2340 pass / 7 fail / 7 skipped；
失败集中于旧公告、README、赛季和 UI 断言，未修改这些无关测试。
主工作区集成 238 pass / 0 fail / 1 skipped，Agent offline 50/50。
初次沙箱测试还出现本机端口 EACCES、临时文件 EPERM，已用正常权限重跑区分。

## 后续部署

恢复 SSH 握手后，核对生产 SHA 和配置；备份一致性 SQLite 和旧镜像，在当前生产
基线上部署候选。先使用内部 embedding 做 shadow 与候选索引真实召回检查，再
发布索引并启用 published；检查 runtime 健康、检索计数及跨版本问题。
流程和回滚说明见 static-knowledge-publication.md。
