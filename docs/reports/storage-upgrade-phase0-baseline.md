# 存储升级阶段 0 基线

2026-08-05 盘点时，工作区实际业务存储为 `.cache/small-window-cache.json`，没有设计文档中所述的业务 SQLite 文件，因此没有伪造 SQLite 备份。当前 JSON 记录数已写入同名 JSON 报告；生产实施时必须对服务器上的真实 SQLite 文件运行 `backup:sqlite`、`storage:baseline` 和迁移校验。

原始回归基线为 625 项测试：611 通过、0 失败、14 跳过。TTL 为会话 30 分钟、查询 5 分钟、默认上下文 6 小时。`.cache/semantic-index.sqlite` 不在首轮迁移范围。
