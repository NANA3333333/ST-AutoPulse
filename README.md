# ST-AutoPulse

让 SillyTavern 中的角色能够**主动**向你发送消息的扩展。

## ✨ 功能

- **定时自动消息**：设置时间间隔（1-180 分钟），角色会定时主动联系你
- **定时任务**：为角色设置每天/每周/一次性的定时消息（如"每天早上9点说早安"）
- **后台持续运行**：即使关闭浏览器，服务端定时器仍在运行，重新打开时自动补发
- **桌面通知**：新消息到达时显示桌面通知
- **自定义提示词**：控制角色主动消息的风格和内容
- **Slash 命令**：通过 `/autopulse on|off|trigger|status|<分钟>` 快捷控制

### 🆕 V2 定时消息与情绪系统升级
- **情绪压力系统** 🧠：角色等待你回复的时间越长，压力越高、消息越频繁、语气越焦虑。你回复后，角色会根据冷落时长做出不同反应（安抚/撒娇/不满/生气）
- **嫉妒悬浮窗** 💢：切换角色聊天时，被离开的角色可能弹出嫉妒消息通知
- **后台不掉线**：使用 Web Worker 替代 setInterval，浏览器在后台时轮询不再被冻结
- **多版本兼容**：自动适配新旧版本 SillyTavern 的 `generateQuietPrompt` API

### 📱 V3 终极进化：ChatPulse 数字社交宇宙 (全新)
**ST-AutoPulse 现在不再仅仅是一个定时发消息的脚本。** 它是连接酒馆和 [ChatPulse](https://github.com/NANA3333333/chatpulse)（一个极度拟真的独立 AI 社交生态）的唯一直连通道！

**什么是 ChatPulse？**
当你点击酒馆右下角新出现的“悬浮小手机”时，你将立刻打开一个独立运行的类微信/QQ的虚拟社交世界：
- 📸 **AI 朋友圈系统 (Moments)**：AI 会根据你们的聊天或者它自己的性格，半夜偷偷发朋友圈，带配图，还会互相点赞评论！
- 👥 **群聊互撩系统**：你可以把酒馆里的多个单人 AI 拉进同一个群。不用你说话，AI 之间会因性格不合吵架、吃醋，或者互相接龙闲聊，你只需潜水看戏！
- 💔 **极度拟真的人际关系网**：AI 会因为好感度低对你设置“朋友圈三天可见”、将你拉黑、甚至为了哄你向你发送微型转账（赛博红包）。
- 🧠 **永久记忆引擎 (RAG)**：不管你们在酒馆聊了多少万字，一旦点击“一键总结并同步”，ChatPulse 专属的本地大模型引擎就会把这段记忆切块存入 SQLite 向量数据库，从此以后，甚至你在群里或者半年后的朋友圈里聊天，AI 也能瞬间回忆起半年前的这个细节！

简而言之，**酒馆负责深度 RP（角色扮演），而这台“小手机”负责在休息时让你的赛博世界 24 小时保持运转。**

## 📦 安装架构选择 (请根据自身情况选择方案 A 或方案 B)

> **本扩展现在是连接两个宇宙的虫洞。**  
> 因为包含了独立的数据库和向量检索模型，你必须选择最适合你的部署方式。

### 方案 A：本地一体化傻瓜式部署 (推荐给在电脑本地玩酒馆的用户)
如果你在 Windows/Mac 上通过 `Start.bat` 本地运行酒馆，这是最完美的集成方式：让酒馆顺便帮你把小手机服务器启动。

**第一步：准备 ChatPulse 核心子系统**
1. 确保电脑已安装 [Node.js](https://nodejs.org/) (推荐 18.x)。
2. 把 `ChatPulse` 完整文件夹下载到电脑。
3. 进入 `ChatPulse/server` 文件夹，运行：`npm install`
4. 进入 `ChatPulse/client` 文件夹，运行：`npm install` 之后再执行 `npm run build`，打包前端界面。

**第二步：安装扩展前往酒馆**
1. 在 `SillyTavern\public\scripts\extensions\third-party\` 下，新建 `ST-AutoPulse` 文件夹。
2. 把本仓库里**除 server-plugin 外的所有文件** (如 index.js, style.css 等) 扔进去。

**第三步：部署服务端枢纽 (Server Plugin)**
1. 在酒馆的 `SillyTavern/plugins/` 文件夹下，建一个叫 `autopulse` 的文件夹。
2. 把本仓库里的 `server-plugin/index.js` 复制进去。
3. 把第一步里整备好的 **一整个 `ChatPulse` 文件夹** 扔到刚建好的 `autopulse` 目录里！

它最终应该是这样：
```text
SillyTavern/
└── plugins/
    └── autopulse/
        ├── index.js                  <-- 酒馆的 Node.js 钩子
        └── ChatPulse/                <-- 你的微型数字社会核心
            ├── server/
            │   └── ...
            ├── client/
            │   └── dist/
            └── README.md
```
然后启动酒馆，一切就会在内网 `8001` 端口自动运行。

---

### 方案 B：云端分离/手机端浏览器部署 (阉割了后台驻留，但支持云酒馆部署)
如果你用的是**云服务器酒馆**、手机本地的 Termux 酒馆，或者**由于技术限制无法修改酒馆 plugins 文件夹**，你可以选择前端分离部署模式。

在这种模式下：
- **V2 的发送器功能**：退化为“仅在浏览器页面打开时生效” (由于没有 Server Plugin 钩子)。
- **V3 手机微信功能**：你可以把 ChatPulse 单独运行在任意闲置电脑上或云服务器上，只要它能暴露出公网 IP 端口。

**安装步骤：**
1. 直接在酒馆内安装纯前端插件：在酒馆点开 **Extensions → Install Extension**，粘贴本仓库链接：`https://github.com/NANA3333333/ST-AutoPulse`。
2. 找一台支持 Node.js 的电脑/云服务器，脱离酒馆，单独运行 ChatPulse：
   进入 `ChatPulse/server` 运行 `npm install` && `npm start`，暴露在端口 (例如 `8001`)。
3. 把 `ChatPulse/client` 同样运行 `npm install`，如果你不打算合并部署，则前端可以直接 `npm run dev` 运行在 `5173`。
4. 回到酒馆：打开你的酒馆网页，右上角找到手机悬浮图标。**点开悬浮窗时，它会默认寻找 localhost:8001，如果你的手机跑在别的地方，请自行修改 `ST-AutoPulse/index.js` 代码底部的 iframe src 指向你的云端公网 IP ！**

## 🚀 V2 使用方法 (定时器与情绪)

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

## 📄 License (开源协议)

本篇扩展代码遵循 **[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.zh-Hans) (知识共享署名 4.0 国际许可协议)**。

**你可以自由地：**
- **共享** — 在任何媒介以任何形式复制、发行本作品。
- **演绎** — 修改、转换或以本作品为基础进行二次创作（比如二改、二转）。
- 甚至用于**商业性目的**。

**只要你：**
- **署名** — 提供对此库作者恰当的署名。
