# ST-AutoPulse Lite

中文说明 | [English Documentation](README_EN.md)
让 SillyTavern 中的角色能够**主动**向你发送消息的扩展。

**纯前端版本** — 无需安装 Server Plugin，开箱即用，适合云酒馆和无法安装插件的环境。

> 💡 如果你的酒馆是本地部署或自建 VPS，推荐使用 [完整版 ST-AutoPulse](https://github.com/NANA3333333/ST-AutoPulse)，支持后台持续运行和定时任务。

## ✨ 功能

- **定时自动消息**：设置时间间隔（1-180 分钟），角色会定时主动联系你
- **自定义提示词**：控制角色主动消息的风格和内容
- **桌面通知**：新消息到达时显示桌面通知
- **智能重置**：你发消息时自动重置计时器
- **Slash 命令**：通过 `/autopulse on|off|trigger|status|<分钟>` 快捷控制
- **[NEW] 情绪压力系统 (V2)**：角色等待时间越长，回复的间隔越短，且语气会变得更加焦虑。当用户回归时，角色会产生特定反应（如松了一口气/抱怨/生气）。
- **[NEW] 浮窗吃醋系统 (V2)**：当你无视当前角色并切换到其他角色聊天时，该角色有几率在右下角以浮窗形式向你发送吃醋/抗议消息。

### 🐛 V2 近期修复 (Bug Fixes)
- **修复手机端/不支持的浏览器弹窗崩溃**：捕获了 `Notification` API 的 `Illegal constructor` 错误，现在即使不支持桌面通知，也会安全回退到网页端浮窗提示，不再导致插件生成中断。
- **过滤推理模型思维链**：为嫉妒消息的生成添加了针对 `<think>...</think>` 标签的过滤，防止如 DeepSeek-R1 等带有思维链功能的新模型在弹窗中直接暴露思考过程。

## ⚠️ Lite 版 vs 完整版

| 功能 | Lite 版 | 完整版 |
|------|---------|--------|
| 定时自动消息 | ✅ | ✅ |
| 自定义提示词 | ✅ | ✅ |
| 桌面通知 | ✅ | ✅ |
| Slash 命令 | ✅ | ✅ |
| 情绪压力系统 | ✅ | ✅ |
| 浮窗吃醋系统 | ✅ | ✅ |
| 关闭页面后继续运行 | ❌ | ✅ |
| 定时任务（每天/每周） | ❌ | ✅ |
| 离线消息补发 | ❌ | ✅ |
| 需要 Server Plugin | ❌ 不需要 | ✅ 需要 |
| 适合云酒馆 | ✅ | ❌ |

## 📦 安装

在 SillyTavern 中打开 **Extensions → Install Extension**，粘贴本仓库链接：

```
https://github.com/NANA3333333/ST-AutoPulse-Lite
```

**就这么简单！** 不需要安装 Server Plugin，不需要修改 config.yaml。

## 🚀 使用方法

1. 在 SillyTavern 左侧菜单打开 **Extensions** 面板
2. 找到 **ST-AutoPulse Lite** 设置区域
3. 勾选 **启用自动消息**
4. 设置消息间隔时间
5. （可选）自定义触发提示词

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
┌──────────────────────────────┐
│    SillyTavern (浏览器)       │
│                              │
│  setInterval (定时器)         │
│       ↓ 到时间了              │
│  generateQuietPrompt (生成)   │
│       ↓                      │
│  addOneMessage (显示到聊天)    │
└──────────────────────────────┘
```

所有逻辑都在浏览器中运行，不依赖任何后台服务。

## ❓ 常见问题

**Q: 关闭页面后定时器还会运行吗？**
A: 不会。Lite 版的定时器在浏览器中运行，关闭页面就停止了。如需后台运行，请使用[完整版](https://github.com/NANA3333333/ST-AutoPulse)。

**Q: 消息生成报错？**
A: 错误来自你配置的 LLM API，不是插件的问题。请确保 API 能正常使用。

**Q: 可以和完整版同时安装吗？**
A: 不建议，因为两者 Slash 命令名相同（`/autopulse`）会冲突。请选择其中一个安装。

## 📄 License

MIT
