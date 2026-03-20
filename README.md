# ST-AutoPulse

## Update Notes (2026-03-20)

- Fixed the `characterId = 0` bug that could make the first character fail to trigger auto messages, jealousy, or offline queue handling.
- Fixed offline queue clearing logic so unhandled events are no longer deleted prematurely.
- Fixed jealousy context mixing so a jealous character no longer reads the currently open chat by mistake.
- Added a `Custom Jailbreak Prompt` field for jealousy generation. When enabled, custom text is used first and falls back to the built-in preset if empty.
- Fixed the broken settings HTML caused by the new jailbreak textarea so the rest of the panel and the `⚙️` independent API modal can render again.
- Improved server-timer resume behavior: reopening SillyTavern now reuses the server plugin's existing timer instead of always resetting it.
- Reduced one source of lag by removing a redundant timer reset request after user messages.

让 SillyTavern 中的角色能够**主动**向你发送消息的扩展。

## ✨ 功能

- **定时自动消息**：设置时间间隔（1-180 分钟），角色会定时主动联系你
- **定时任务**：为角色设置每天/每周/一次性的定时消息（如"每天早上9点说早安"）
- **后台持续运行**：即使关闭浏览器，服务端定时器仍在运行，重新打开时自动补发
- **桌面通知**：新消息到达时显示桌面通知
- **自定义提示词**：控制角色主动消息的风格和内容
- **Slash 命令**：通过 `/autopulse on|off|trigger|status|<分钟>` 快捷控制

### 🧠 情绪压力系统
角色等待你回复的时间越长，压力越高、消息越频繁、语气越焦虑。你回复后，角色会根据冷落时长做出不同反应（安抚/撒娇/不满/生气）。

### 💢 嫉妒悬浮窗
切换角色聊天时，被离开的角色可能弹出嫉妒消息通知。可调节触发概率、延迟时间，和自定义嫉妒提示词。

### ⚡ 后台不掉线
使用 Web Worker 替代 setInterval，浏览器在后台时轮询不再被冻结。

### 🔄 多版本兼容
自动适配新旧版本 SillyTavern 的 `generateQuietPrompt` API。

---

## 📦 安装

### 第一步：安装前端扩展

1. 在酒馆目录 `SillyTavern/public/scripts/extensions/third-party/` 下，新建 `ST-AutoPulse` 文件夹。
2. 将 `index.js`, `style.css`, `settings.html`, `manifest.json` 复制进去。

### 第二步：部署服务端插件（推荐，可选）

1. 在酒馆 `SillyTavern/plugins/` 下，建 `autopulse` 文件夹。
2. 将 `server-plugin/index.js` 复制进去。
3. 确保 `config.yaml` 中 `enableServerPlugins: true`。

最终结构：
```text
SillyTavern/
├── public/scripts/extensions/third-party/
│   └── ST-AutoPulse/
│       ├── index.js
│       ├── style.css
│       ├── settings.html
│       └── manifest.json
└── plugins/
    └── autopulse/
        └── index.js
```

> 如果不装 Server Plugin，插件会以**前端模式**运行（关闭页面后定时器停止）。

---

## 🚀 使用方法

1. 在 SillyTavern 左侧菜单打开 **Extensions** 面板
2. 找到 **ST-AutoPulse** 设置区域
3. 勾选 **启用自动消息**
4. 设置消息间隔时间
5. （可选）自定义触发提示词
6. （可选）添加定时任务
7. （可选）启用情绪压力系统
8. （可选）启用嫉妒系统

### 情绪压力系统

启用后，角色会根据你多久没回复产生不同等级的焦虑：

| 压力等级 | 效果 |
|---------|------|
| 😊 0 | 正常间隔发消息 |
| 😐 1 | 间隔缩短 30%，"开始想你了" |
| 😟 2 | 间隔缩短 50%，"开始担心你了" |
| 😰 3 | 间隔缩短 70%，"焦虑不安" |
| 😭 4 | 间隔缩短 80%，"情绪到达极限" |

**回归反应**：当你终于回复时，角色会根据之前的压力等级做出反应。

### 嫉妒系统

启用后，当你从角色A切换到角色B聊天时，角色A有一定概率（可调节）在一段时间后弹出嫉妒消息的悬浮通知。可调节：

- 触发概率（0-100%）
- 最短/最长延迟（秒）
- 自定义嫉妒提示词

### Slash 命令

| 命令 | 功能 |
|------|------|
| `/autopulse on` | 启用自动消息 |
| `/autopulse off` | 禁用自动消息 |
| `/autopulse trigger` | 立即触发一次消息 |
| `/autopulse status` | 查看当前状态 |
| `/autopulse 30` | 设置间隔为 30 分钟 |

## ⚙️ 工作原理

```
┌──────────────┐  Web Worker   ┌──────────────────┐
│  UI Extension ├──────────────►│  Server Plugin    │
│  (浏览器)     │◄──────────────┤  (Node.js 后台)   │
│              │  触发事件      │                  │
│  生成消息     │              │  管理定时器       │
│  压力系统     │              │  动态间隔调整     │
│  嫉妒悬浮窗   │              │  排队离线事件     │
└──────────────┘              └──────────────────┘
```

## ❓ 常见问题

### 显示"未连接到服务端"

1. 检查 `config.yaml`：确保 `enableServerPlugins: true`
2. 检查文件位置：Server Plugin 必须在 `SillyTavern/plugins/autopulse/index.js`
3. 看启动日志：终端应显示 `[AutoPulse] Server plugin initialized successfully!`
4. 测试 API：浏览器访问 `http://你的地址:端口/api/plugins/autopulse/status`

### 已连接但"立即触发"没反应

打开浏览器 F12 → Console，点击"立即触发"后看日志：

| 日志 | 问题 | 解决 |
|------|------|------|
| `No active chat` | 没选角色 | 先打开一个角色聊天 |
| `Empty chat` | 空聊天 | 先发一条消息 |
| `Already generating` | 卡住了 | 刷新页面重试 |

## 🔄 兼容性

- SillyTavern **1.12.0+** — 推荐
- SillyTavern **1.15.0** — 完全兼容
- SillyTavern **1.16.0+** — 兼容（自动适配新版 API）
- 旧版本 — 通过兼容层自动降级

## 📄 License

本扩展遵循 **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh-Hans)**。

**你可以自由地：** 共享、演绎、甚至用于商业目的。
**只要你：** 署名 — 提供对此库作者恰当的署名。
