# ST-AutoPulse

让 SillyTavern 中的角色能够**主动**向你发送消息的扩展。

## ✨ 功能

- **定时自动消息**：设置时间间隔（1-180 分钟），角色会定时主动联系你
- **定时任务**：为角色设置每天/每周/一次性的定时消息（如"每天早上9点说早安"）
- **后台持续运行**：即使关闭浏览器，服务端定时器仍在运行，重新打开时自动补发
- **桌面通知**：新消息到达时显示桌面通知
- **自定义提示词**：控制角色主动消息的风格和内容
- **Slash 命令**：通过 `/autopulse on|off|trigger|status|<分钟>` 快捷控制

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
┌──────────────┐  轮询(5s)  ┌──────────────────┐
│  UI Extension ├──────────►│  Server Plugin    │
│  (浏览器)     │◄──────────┤  (Node.js 后台)   │
│              │  触发事件   │                  │
│  生成消息     │           │  管理定时器       │
│  显示到聊天   │           │  排队离线事件     │
└──────────────┘           └──────────────────┘
```

1. **Server Plugin** 在 Node.js 后台管理定时器，即使浏览器关闭也不停
2. **UI Extension** 每 5 秒轮询服务端，检查是否有触发事件
3. 收到触发事件后，调用 `generateQuietPrompt()` 生成消息
4. 通过 `addOneMessage()` 将消息显示在聊天窗口中
5. 如果浏览器未打开，事件进入离线队列，下次打开时自动补发

## ❓ 常见问题

**Q: 显示"未连接到服务端"怎么办？**  
A: 请确认：① Server Plugin 文件放在 `plugins/autopulse/index.js` ② `config.yaml` 中 `enableServerPlugins: true` ③ 重启了 SillyTavern

**Q: 消息生成报错？**  
A: 错误来自你配置的 LLM API，不是插件的问题。请确保 API 能正常使用（先手动发消息测试）。

**Q: 关闭浏览器后定时器还会运行吗？**  
A: 会！Server Plugin 在 Node.js 后台运行。关闭期间的触发事件会排队，重新打开浏览器后自动补发。

## 📄 License

CC BY-NC-SA 4.0

