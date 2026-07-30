# 给 Codex 的补充说明：第一阶段直接实现 YouTube

主仓库：

```text
https://github.com/Chencc7002/tftclarity
```

只读参考仓库：

```text
https://github.com/victorxia18/tft-meta-mind
```

主需求文档：

```text
tftclarity-youtube-hybrid-codex-handoff-v2.md
```

## 1. 优先级

请按以下优先级执行：

1. `tftclarity` 现有代码、测试和架构约束；
2. `tftclarity-youtube-hybrid-codex-handoff-v2.md`；
3. `tft-meta-mind` 参考代码。

`tft-meta-mind` 是只读参考实现，不是目标架构。

## 2. 当前阶段目标

本阶段直接实现 YouTube 攻略接入，不再只预留接口。

需要完成的最小闭环：

```text
用户：霞最好的装备是什么，为什么？
        ↓
MetaTFT 查询当前装备数据
        +
YouTube 检索霞的相关攻略
        ↓
DeepSeek 综合回答
        ↓
左侧：结论、原因、条件和替代建议
右侧：MetaTFT 数据、视频标题、作者、日期和时间点
```

## 3. 参考项目重点文件

重点读取：

```text
scraper/youtube.py
pipeline/document_generator.py
rag/vector_store.py
chatbot/app.py
README.md
tft_meta_mind_blueprint.md
LICENSE
```

重点复用或参考：

- YouTube 视频 ID 解析；
- 字幕和时间戳获取；
- 视频元数据；
- 长视频分段；
- 重复视频检测；
- 本地采集、服务器入库的思路；
- 攻略提取栏目；
- 标题级文档切块；
- 来源 metadata。

## 4. 必须替换

```text
Gemini
→ tftclarity 现有 OpenAI-compatible Provider / DeepSeek

自由 Markdown 攻略
→ 统一 KnowledgeDocument JSON

ChromaDB
→ tftclarity 现有 SQLite 语义索引

原项目聊天层
→ tftclarity 现有聊天和会话系统

tactics.tools
→ 现有 MetaTFT 查询链
```

## 5. 禁止接入

禁止为了复用参考项目而引入：

- Streamlit；
- 第二套用户界面；
- 第二套聊天服务；
- 第二套会话状态；
- 第二套结论系统；
- ChromaDB 作为强制依赖；
- Gemini 作为强制依赖；
- 简单正则 Router 替代现有解析；
- 视频观点覆盖 MetaTFT 当前统计；
- 完整复制参考仓库到主项目。

## 6. 允许的 Python 子工具

第一阶段可以保留 Python ingestion 工具，以降低开发成本。

Python 只负责：

```text
YouTube URL
→ 字幕与元数据
→ 长视频分段
→ DeepSeek 提取
→ KnowledgeDocument JSON
```

Node 主服务负责：

```text
知识入库
→ 检索
→ MetaTFT 查询
→ EvidenceBundle
→ 最终 DeepSeek 回答
→ Validator
→ 前端返回
```

## 7. 结论权威

用户询问“当前最好、当前最强、当前表现”时：

```text
MetaTFT 数据
→ 决定主结论和排序

YouTube 攻略
→ 解释原因、制作优先级、过渡、条件和针对方案
```

数据与视频冲突时，不得让视频覆盖统计首选。应表达为：

> 当前整体统计仍支持 A；该作者建议在条件 X 下使用 B，因此 B 是条件性方案。

## 8. 第一批交付

第一批 PR 至少应完成：

1. `KnowledgeDocument`；
2. `EvidenceBundle`；
3. `AnswerModeRouter`；
4. YouTube 手动 URL 导入；
5. 字幕、时间戳和元数据；
6. 长视频分段；
7. DeepSeek 结构化知识提取；
8. JSON Schema 校验；
9. `video_guides` namespace 入库；
10. 基础检索 smoke test。

后续 PR 完成：

11. MetaTFT + YouTube Hybrid 回答；
12. 左侧回答与右侧证据面板；
13. 冲突规则和降级；
14. 完整回归测试。

## 9. 开工要求

开始编码前先输出：

- 两仓库模块映射；
- 可直接移植、需要重写、禁止使用的代码；
- Node/Python 边界；
- 新依赖；
- 许可证保留方式；
- 变更文件清单；
- PR 拆分；
- 测试计划。

完成分析后直接开始开发，不要只给方案。
