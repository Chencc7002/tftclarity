# 棋子与羁绊目录浏览开发说明

更新时间：2026-07-28

## 目标

增加两个当前赛季、只读、确定性的资料浏览入口：

- 棋子大全：返回当前赛季全部可见棋子，支持本地搜索与费用筛选。
- 羁绊大全：返回当前赛季全部羁绊，按基础羁绊 ID 合并激活档位，支持本地搜索与种族/职业筛选。

点击目录卡片后通过稳定实体 ID 读取现有棋子或羁绊详情，不重新调用 LLM 判断用户意图。

## 数据与边界

- 当前赛季可见范围来自运行时动态 `catalog.units`、`catalog.traits`。
- 名称、定位、技能、属性、羁绊效果和激活档位来自现有腾讯官方实体详情目录。
- 棋子图标复用现有资产解析器，羁绊图标使用官方详情字段。
- 官方详情暂时缺失时，实体仍可以出现在当前赛季目录中，并标记 `hasDetails=false`；不制造缺失描述。
- 不把全量目录放入 LLM 上下文，不让 LLM 执行筛选、去重或分页。
- 本阶段不增加装备大全，不实现“某羁绊包含哪些棋子”的关系页。

## HTTP 契约

### 目录

```http
GET /api/entity-catalog?type=unit&seasonContextId=set17-live
GET /api/entity-catalog?type=trait&seasonContextId=set17-live
```

可选参数：

- 通用：`query`、`page`、`limit`、`refresh`
- 棋子：`cost`、`role`、`trait`
- 羁绊：`traitType=race|job`

最大 `limit=200`。返回 `type=entity_catalog`、`entityType`、`items`、`pagination`、`filters` 和当前 `seasonContext`。

### 详情

```http
GET /api/entity-details?type=unit&id=TFT17_Xayah&seasonContextId=set17-live
GET /api/entity-details?type=trait&id=TFT17_Stargazer&seasonContextId=set17-live
```

详情接口复用现有 `unit_details`、`trait_details` 响应结构和前端详情卡片。

## 自然语言入口

以下表达在调用 LLM 之前进入确定性目录查询：

- 返回全部棋子
- 查看所有英雄
- 棋子大全、英雄列表、棋子图鉴
- 返回全部羁绊
- 羁绊大全、羁绊列表、羁绊图鉴
- Show all champions
- Show all traits

单个英雄名仍按既有策略澄清“推荐装备还是所在阵容”，不会与目录查询冲突。

## 前端

“资料百科”分类新增：

- 全部棋子
- 全部羁绊

目录默认一次加载当前赛季全部实体，在浏览器内搜索和筛选。点击卡片调用 `/api/entity-details`，详情页提供返回目录入口，并保留原来的目录滚动位置。

## 代码位置

- 目录构建：`src/core/entity-catalog.js`
- HTTP、自然语言预路由与详情直达：`src/app/small-window-server.js`
- 列表、筛选、目录/详情导航：`src/app/small-window-ui/app.js`
- 样式：`src/app/small-window-ui/styles.css`
- 中英文：`src/app/small-window-ui/i18n.js`
- 测试：`test/entity-catalog.test.js`、`test/small-window-server.test.js`、`test/small-window-ui.test.js`
