# ST-AutoPulse Lite

[中文说明](README.md) | English Documentation

An extension for SillyTavern that allows characters to **proactively** send messages to you.

**Pure Frontend Version** — Works directly in your browser without needing to install a Node.js Server Plugin. Perfect for cloud deployments or environments where installing server-side plugins is not possible.

> **Note to the international community:**  
> This extension is primarily developed and maintained for the CN community. English documentation is provided as-is to share these features with everyone. Support for English issues may be delayed or unavailable. Feel free to fork or submit PRs if you want to help with localization or bug fixes!
> 
> 💡 If you are running SillyTavern locally or on a VPS, it's highly recommended to use the [Full Version of ST-AutoPulse](https://github.com/NANA3333333/ST-AutoPulse), which supports true persistent background processing and scheduled tasks.

## ✨ Features

- **Scheduled Auto-Messaging**: Set an interval (1-180 minutes), and the character will proactively initiate conversation.
- **Custom Prompts**: Fully control the style, context, and behavior of the proactive messages.
- **Desktop Notifications**: Get native desktop notifications when a character reaches out.
- **Smart Reset**: Any user message will automatically reset the countdown timer.
- **Slash Commands**: Quickly control the extension using `/autopulse on|off|trigger|status|<minutes>`.
- **[NEW] Emotional Pressure System (V2)**: The longer the character waits for your reply, the higher their "anxiety" becomes, decreasing the interval between their messages. When you finally reply, they will have a specific "return reaction" (e.g., relief, complaining, or anger).
- **[NEW] Jealousy Popup System (V2)**: When you switch away from the current character to chat with a different character, the ignored character has a chance to send a floating jealousy/protest notification in the bottom right corner.

## ⚠️ Lite Version vs Full Version

| Feature | Lite Version | Full Version |
|---------|--------------|--------------|
| Scheduled Auto-Messaging | ✅ | ✅ |
| Custom Prompts | ✅ | ✅ |
| Desktop Notifications | ✅ | ✅ |
| Slash Commands | ✅ | ✅ |
| Emotional Pressure System | ✅ | ✅ |
| Jealousy Popup System | ✅ | ✅ |
| Keeps running after closing tab | ❌ | ✅ |
| Scheduled Tasks (Daily/Weekly) | ❌ | ✅ |
| Offline Message Queuing | ❌ | ✅ |
| Requires Server Plugin | ❌ No | ✅ Yes |
| Cloud-host friendly | ✅ | ❌ |

## 📦 Installation

In SillyTavern, open **Extensions → Install Extension**, and paste this repository link:

```
https://github.com/NANA3333333/ST-AutoPulse-Lite
```

**That's it!** You don't need to install any Server Plugin, and you don't need to edit your `config.yaml`.

## 🚀 How to Use

1. Open the **Extensions** panel on the left side of SillyTavern.
2. Locate the **ST-AutoPulse Lite** settings.
3. Check **Enable Auto Messages**.
4. Set your desired message interval.
5. (Optional) Customize the trigger and task prompts.

### Slash Commands

| Command | Function |
|---------|----------|
| `/autopulse on` | Enable auto messages |
| `/autopulse off` | Disable auto messages |
| `/autopulse trigger` | Trigger a message instantly |
| `/autopulse status` | Check the current status |
| `/autopulse 30` | Set interval to 30 minutes |

## 📄 License

MIT
