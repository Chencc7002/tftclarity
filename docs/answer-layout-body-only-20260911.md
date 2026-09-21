# 聊天正文密集排版修复

2026-09-11。用户截图为英雄名称确认后的 ReAct 装备回答。

## 原理与根因

渲染链路为 `modelConclusion.answer / reactAnswer → reactModelConclusionHtml → conclusionRichTextHtml({ bodyOnly: true }) → HTML → CSS`。

原有富文本模块支持 Markdown、自动分句及装备排行榜列表。后来为了隐藏“模型原始结论、系统结论”等注释标题，`bodyOnly` 分支直接使用原文而跳过 `autoStructuredConclusionText`。这个开关将“标题展示”与“正文结构化”错误绑定：模型给出 Markdown 时表现正常，模型返回一段文字时只生成一个 `<p>`。CSS 只能在该段落内折行，无法生成分节与组合列表。正文 580、列表 600 的默认字重，以及手机端 6px 的块间距进一步增加视觉密度。

生产基线 `456291092787b3237c2b0157ed754381b56bfeaf` 与主工作区的富文本模块一致，因此并非之前优化未发布。之前测试覆盖格式化输入与隐藏标签，却未覆盖实际 ReAct 卡片下的单段装备回答。

## 修改边界

- `bodyOnly` 仍隐藏多余注释，但不再禁用正文布局。
- 对具有至少两个明确装备章节标签的单段文字生成独立小节。主流出装中以顿号隔开的完整组合逐条显示；其余段落按句号、分号划分。
- 括号和中括号内不拆分，保护装备组合附带的指标、嵌套说明、小数与千分位。保留文字和标点，不推断新建议、不改动回答或 Evidence 数据。
- 已有 Markdown 优先保留；短回答不强制生成标题。规则无法识别章节时退回通用自动分段。
- 正文字重 400、行高 1.8、块间距 12px；标题和显式重点仍有视觉层级，列表间距 8px。
- 只修改共享富文本展示和 CSS，无工具、提示词、Agent 路由、权限、预算或数据库变化。

截图原文保存为 `test/fixtures/dense-equipment-answer.js`，仅用于排版测试，不代表当前统计或经过审核的建议。新增测试覆盖实际 ReAct 卡片的模型原文与系统回答入口、正文标签删除、三条完整出装、指标保留、文本逐字符等价（忽略布局空白）、已有 Markdown 以及 HTML 转义。

## 验证

- 主工作区相关测试 87/87。
- Browser 使用实际 `reactModelConclusionHtml` 与截图原文，在 390×844 下显示三个标题、三条组合列表；文档宽度为 390，正文计算字重 400，块间距 12px。
- 本地复现服务 `.cache/dense-answer-preview.mjs`，相关日志 `.cache/dense-answer-focused.log`。
- 独立发布树 `.cache/answer-layout-release-20260911` 仅移入本次展示增量，保留已上线转职图片与配装修复及公告证据链。
