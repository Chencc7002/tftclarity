# 小窗启动器

本项目当前提供零依赖 Windows 启动器，用于把本地 Web 小窗以桌面 app 窗口形式打开。

## 启动

```powershell
npm run window
```

等价于：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start-small-window.ps1
```

默认行为：

- 启动本地服务 `http://127.0.0.1:17317/`。
- 如果端口上已有健康服务，则复用已有服务。
- 用 Edge 或 Chrome 的 app window 模式打开固定宽度小窗。
- 浏览器 profile 保存在 `.cache/small-window-browser-profile`。

## 常用参数

```powershell
scripts\start-small-window.ps1 -NoBrowser
scripts\start-small-window.ps1 -Port 17318
scripts\start-small-window.ps1 -Width 460 -Height 760
scripts\start-small-window.ps1 -TopMost -WindowLeft 1480 -WindowTop 80
scripts\start-small-window.ps1 -BrowserPath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
scripts\start-small-window.ps1 -CacheStore sqlite -CachePath ".cache\small-window-cache.sqlite"
```

`-NoBrowser` 只启动和检查服务，适合测试、脚本验证或已经有窗口打开时使用。

`-TopMost` 会在 Edge/Chrome app window 打开后，通过 Win32 `SetWindowPos` 尝试把标题包含 `TFTAgent` 的窗口设为置顶，并按 `-WindowLeft`、`-WindowTop`、`-Width`、`-Height` 重新定位。若游戏以独占全屏运行，浏览器窗口仍可能无法覆盖游戏；建议使用无边框窗口化或窗口化模式。

默认会启动一个单实例后台热键辅助进程：按 `Ctrl+Shift+Space` 可恢复并置前标题包含 `TFTAgent` 的 Edge/Chrome app window。可按下面方式关闭或改键：

```powershell
scripts\start-small-window.ps1 -NoHotkey
scripts\start-small-window.ps1 -Hotkey "Ctrl+Alt+Space"
```

热键辅助进程只负责窗口激活，不读取查询、缓存、账号或 API 密钥。若所选组合已被其他程序注册，辅助进程无法注册该热键；可改用另一组组合键或使用 `-NoHotkey`。

小窗核心 Explorer 查询、目录请求和 `/comps` 辅助请求默认都最多等待 2.2 秒。核心查询超时后会优先回退过期查询缓存并显示更新时间；目录或阵容上下文超时后会保留本地字典，或退化为不带默认羁绊的 Explorer 查询。预取失败状态会直接传入推荐链路，不会对同一 `/comps` 端点重复等待。

可通过环境变量分别调整三个边界；设置面板运行状态会显示当前核心查询超时：

```powershell
$env:TFT_AGENT_EXPLORER_TIMEOUT_MS = "2200"
$env:TFT_AGENT_CATALOG_TIMEOUT_MS = "2200"
$env:TFT_AGENT_COMPS_TIMEOUT_MS = "2200"
npm run window:server
```

直接启动 Node 服务时也可使用 CLI 参数：

```powershell
npm start -- --explorer-timeout-ms=2200 --catalog-timeout-ms=2200 --comps-timeout-ms=2200
```

Windows 桌面环境可用以下命令验证辅助进程能够注册并释放全局热键。它使用独立的 `Ctrl+Alt+F24` 和互斥体，1 秒后自动退出：

```powershell
npm run smoke:hotkey
```

安装了 Playwright 且本机存在 Edge/Chrome 时，可运行可选视觉 smoke。它会使用离线 fixture 检查 460px 推荐卡、360px 低样本卡和 360px 零结果摘要，并检测横向溢出与紧凑控件文字裁切：

```powershell
npm run smoke:visual

node scripts\smoke-small-window-visual.mjs `
  --playwright-module "C:\path\to\playwright\index.mjs" `
  --browser "C:\path\to\msedge.exe" `
  --output ".cache\visual-smoke"
```

未安装 Playwright 时脚本会明确输出 skipped，不影响不含浏览器依赖的默认测试和小窗运行。

## 可选 LLM 解析

默认不启用 LLM，所有高频输入仍走规则和字典。需要给低置信输入启用结构化解析兜底时，可以复制 `.env.example` 为 `.env`，填写 OpenAI-compatible provider：

```env
OPENAI_API_KEY=your_openai_compatible_api_key
OPENAI_BASE_URL=https://aihubmix.com/v1
MODEL_NAME=your_model_id
TFT_AGENT_LLM_MODE=auto
TFT_AGENT_LLM_TIMEOUT_MS=3000
```

`npm start`、`npm run window` 和 `npm run window:server` 启动的小窗服务会自动读取项目根目录 `.env`。`OPENAI_BASE_URL` 会补成 `/chat/completions` 请求地址；真实 `.env` 已被 Git 忽略。配置后可先运行：

```powershell
npm run smoke:llm
```

也可以继续通过当前 shell 的环境变量覆盖 `.env`：

```powershell
$env:TFT_AGENT_LLM_PROVIDER = "chat"
$env:TFT_AGENT_LLM_ENDPOINT = "https://your-provider.example/v1/chat/completions"
$env:TFT_AGENT_LLM_MODEL = "your-model"
$env:TFT_AGENT_LLM_API_KEY = "your-api-key"
$env:TFT_AGENT_LLM_MODE = "auto"
$env:TFT_AGENT_LLM_TIMEOUT_MS = "1500"
npm run window:server
```

`TFT_AGENT_LLM_MODE=auto` 会在规则/字典没识别出英雄，或检测到显式但未解析的装备/羁绊片段时调用 provider；`always` 用于调试，`never` 可强制关闭。模型输出仍必须通过本地 schema、字典、ContextBuilder 和 QueryValidator，不能直接决定推荐或统计数字。

小窗设置面板会读取 `GET /api/runtime` 展示缓存类型和 LLM provider/mode/model；可保存“继承/自动/关闭/始终”解析策略。endpoint、model 和 API key 只来自环境变量或启动参数，页面和长期偏好不会保存或返回它们的原始值。

## 缓存存储

默认使用零依赖 JSON 缓存：

```text
.cache/small-window-cache.json
```

可以通过环境变量或启动器参数切换为 SQLite：

```powershell
$env:TFT_AGENT_CACHE_STORE = "sqlite"
$env:TFT_AGENT_CACHE_PATH = ".cache\small-window-cache.sqlite"
npm run window:server

scripts\start-small-window.ps1 -NoBrowser -CacheStore sqlite -CachePath ".cache\small-window-cache.sqlite"
```

SQLite 模式需要运行环境提供 `node:sqlite` 或 `better-sqlite3`。推荐使用提供 `node:sqlite` 的 Node 22.5+（当前已用 Node 24.14.0 完成真实文件库 smoke）；也可继续使用 Node 18 并安装 optional `better-sqlite3`。无法取得 driver 时 npm 不会阻断默认 JSON 小窗，SQLite 模式会明确报错。

启动器支持通过 `-NodePath` 为 SQLite 模式指定较新的 Node，而不改变系统默认 Node：

```powershell
scripts\start-small-window.ps1 -NoBrowser `
  -NodePath "C:\path\to\node.exe" `
  -CacheStore sqlite `
  -CachePath ".cache\small-window-cache.sqlite"
```

如需强制显示 optional driver 的安装问题，可运行：

```powershell
npm install --include=optional --foreground-scripts
```

若预编译包下载不可用，`better-sqlite3` 回退编译需要 Python 3 和 MSVC C++ Build Tools；完成后重跑 `npm run smoke:sqlite`。

可以用 smoke 脚本检查当前环境是否具备真实 SQLite 文件库能力：

```powershell
npm run smoke:sqlite

$env:SQLITE_SMOKE_PATH = ".cache\sqlite-smoke.sqlite"
$env:SQLITE_SMOKE_KEEP = "1"
npm run smoke:sqlite

& "C:\path\to\node.exe" scripts\smoke-sqlite-cache.mjs
```

有 `node:sqlite` 或 `better-sqlite3` 时，脚本会创建 SQLite 文件并覆盖 `user_preferences`、`session_state`、`query_cache`、`default_context_cache`、`item_catalog`、`units`、`traits`、`entity_aliases` 和 `feedback_events` 的读写清理链路；没有 driver 时会输出 `SQLite smoke skipped` 并保持 0 退出码，表示当前环境仍应使用默认 JSON store。

小窗设置面板里的“阵容”可切换懒输入默认阵容策略：`样本` 优先选择样本数最高的主流阵容，`前四` 优先选择前四率更高的阵容，`Score` 优先选择 MetaTFT score 更高的阵容，`均名` 优先选择平均名次更低的阵容。当前 `/comp_options` 若没有前四率字段，`前四` 会按 score、样本数、平均名次兜底。该策略会写入 `small_window` 长期偏好，并进入默认阵容缓存 key。

默认阵容会排除 `/comps` `traits_list` 中带 `UniqueTrait` 或 `Augment` 标记的明确专属玩法候选；普通查询只有这类候选时才会降级使用。输入包含“专属强化”“英雄强化”“赌狗”“D牌/D卡”“追三”或 `reroll` 时，会优先选择特殊候选；该模式会使用独立默认阵容缓存 key。

小窗设置面板里的“清历史”会调用 `POST /api/cache/clear`，清理 query/default-context/session 短期缓存和运行时 catalog cache，但保留 `small_window` 长期偏好，以及按 patch 保存的装备、英雄和羁绊目录。

每张结果卡右下角提供上/下反馈按钮。反馈会保存当前输入、结构化查询、卡片装备与指标快照，用于后续人工分析；不会自动改变排序或长期偏好，同一卡只接受首次反馈。

别名审核区的“清候选”会删除未启用候选别名和全部反馈事件（包括结果卡反馈），并保留已启用别名与长期偏好。

结果区的刷新按钮会绕过当前查询和默认阵容缓存，并重新拉取当前 patch/queue 的运行时装备、英雄、羁绊与阵容目录；不会清空长期偏好或人工审核过的别名。

## 当前边界

这仍是本地 Web 小窗封装，不是最终桌面插件：

- 已有全局热键，以及 Win32 `SetWindowPos` 的置顶/定位能力；尚未实现透明、贴边吸附、托盘、点击穿透等完整桌面窗口能力。
- 后续可以迁移到 Electron、Tauri 或原生 Windows WebView2。
