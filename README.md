# ST-AutoPulse

让 SillyTavern 中的角色能够**主动**向你发送消息的扩展。

## ✨ 功能

- **定时自动消息**：设置时间间隔（1-180 分钟），角色会定时主动联系你
- **定时任务**：为角色设置每天/每周/一次性的定时消息（如"每天早上9点说早安"）
- **后台持续运行**：即使关闭浏览器，服务端定时器仍在运行，重新打开时自动补发
- **桌面通知**：新消息到达时显示桌面通知
- **自定义提示词**：控制角色主动消息的风格和内容
- **Slash 命令**：通过 `/autopulse on|off|trigger|status|<分钟>` 快捷控制

### 🆕 V2 新功能

- **情绪压力系统** 🧠：角色等待你回复的时间越长，压力越高、消息越频繁、语气越焦虑。你回复后，角色会根据冷落时长做出不同反应（安抚/撒娇/不满/生气）
- **嫉妒悬浮窗** 💢：切换角色聊天时，被离开的角色可能弹出嫉妒消息通知
- **后台不掉线**：使用 Web Worker 替代 setInterval，浏览器在后台时轮询不再被冻结
- **多版本兼容**：自动适配新旧版本 SillyTavern 的 `generateQuietPrompt` API

## 📦 安装

> **本扩展包含两部分**：UI Extension（前端）+ Server Plugin（后台）。  
> 酒馆自带的扩展安装器只能安装 UI Extension，Server Plugin 需要手动安装。

### 第一步：安装 UI Extension（自动）

在 SillyTavern 中打开 **Extensions → Install Extension**，粘贴本仓库链接：

```
https://github.com/NANA3333333/ST-AutoPulse
```

### 第二步：安装 Server Plugin（手动）

> ⚠️ **这一步必须手动操作**，否则关闭浏览器后定时器会停止。

1. 在 SillyTavern 根目录下找到 `plugins/` 文件夹（没有就新建）
2. 在 `plugins/` 下创建 `autopulse/` 文件夹
3. 将本仓库中的 `server-plugin/index.js` 复制为 `plugins/autopulse/index.js`

最终结构：
```
SillyTavern/
└── plugins/
    └── autopulse/
        └── index.js
```

### 第三步：启用 Server Plugin

编辑 SillyTavern 根目录的 `config.yaml`，确保以下设置：

```yaml
enableServerPlugins: true
```

### 第四步：重启 SillyTavern

重启后，在扩展管理界面中应能看到 "ST-AutoPulse"，状态应显示绿色"已连接到服务端"。

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

**回归反应**：当你终于回复时，角色会根据之前的压力等级做出反应——低压力时被安抚开心，高压力时生气/撒娇。回归反应只触发一次，之后压力归零。

### 嫉妒系统

启用后，当你从角色A切换到角色B聊天时，角色A有一定概率（可调节）在一段时间后弹出嫉妒消息的悬浮通知。可调节：

- 触发概率（0-100%）
- 最短/最长延迟（秒）

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

## ❓ 常见问题 / 排查指南

### 显示"未连接到服务端"

请按以下步骤逐一排查：

1. **检查 `config.yaml`**：确保 `enableServerPlugins: true`（改完重启）
2. **检查文件位置**：Server Plugin 必须在 `SillyTavern/plugins/autopulse/index.js`
3. **看启动日志**：重启后终端应显示 `[AutoPulse] Server plugin initialized successfully!` 和 `1 server plugin(s) are currently loaded.`
4. **测试 API**：在浏览器访问 `http://你的地址:端口/api/plugins/autopulse/status`，应返回 JSON
5. **Docker 用户**：确保 `plugins` 目录被正确挂载
6. **权限问题**：Linux/Termux 确保文件有读取权限

### 已连接但"立即触发"没反应

打开浏览器 F12 → Console，点击"立即触发"后看日志：

| 看到的日志 | 问题 | 解决 |
|---|---|---|
| `No active chat` | 没选角色 | 先打开一个角色聊天 |
| `Empty chat` | 空聊天 | 先发一条消息 |
| `Already generating` | 卡住了 | 刷新页面重试 |
| `Generating message...` | 正在生成 | 等一会儿 |
| `Generated empty response` | AI 返回空 | 检查 API 配置 |
| `Failed to generate` | 生成报错 | 看报错详情，通常是 API 问题 |
| 没有任何日志 | 插件没加载 | 看 Console 红色报错 |

**快速自测**（在 F12 Console 输入）：
```javascript
const ctx = SillyTavern.getContext();
console.log('角色:', ctx.characterId, '聊天:', ctx.chat?.length);
```

### 后台收不到通知

- V2 已使用 Web Worker 解决此问题。Console 应显示 `Polling started via Web Worker`
- 如果显示 `using setInterval fallback`，说明 Web Worker 创建失败，后台仍会被节流
- 手机浏览器可能限制 Notification API，建议在 Chrome 中允许通知权限

## 🔄 兼容性

- SillyTavern **1.12.0+** — 推荐
- SillyTavern **1.15.0** — 完全兼容
- SillyTavern **1.16.0+** — 兼容（自动适配新版 API）
- 旧版本 — 通过兼容层自动降级

## 📄 License

CC BY-NC-SA 4.0

