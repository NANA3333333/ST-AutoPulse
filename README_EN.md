# ST-AutoPulse

[中文说明](README.md) | English Documentation

An extension for SillyTavern that allows characters to **proactively** send messages to you.

> **Note to the international community:**  
> This extension is primarily developed and maintained for the CN community. English documentation is provided as-is to share these features with everyone. Support for English issues may be delayed or unavailable. Feel free to fork or submit PRs if you want to help with localization or bug fixes!

## ✨ Features

- **Scheduled Auto-Messaging**: Set an interval (1-180 minutes), and the character will proactively initiate conversation.
- **Scheduled Tasks**: Set daily, weekly, or one-time scheduled messages (e.g., "Say Good Morning every day at 9 AM").
- **Persistent Background Processing**: Even if you close your browser, the Node.js server timer keeps ticking. Missed messages will queue up and appear when you return.
- **Desktop Notifications**: Get native desktop notifications when a character reaches out.
- **Custom Prompts**: Fully control the style, context, and behavior of the proactive messages.
- **Slash Commands**: Quickly control the extension using `/autopulse on|off|trigger|status|<minutes>`.

### 🆕 V2 New Features

- **Emotional Pressure System** 🧠: The longer the character waits for your reply, the higher their "pressure" becomes. Their messages will become more frequent, and their tone more anxious. When you finally reply, they will have a "return reaction" (e.g., relieved, pouting, angry) based on how long they were ignored.
- **Jealousy Popup System** 💢: When you switch away from Character A to chat with Character B, Character A has a customizable chance to send a floating jealousy/protest notification.
- **Background Keepalive**: Uses Web Workers instead of simple intervals to prevent modern browsers from freezing the extension when tabbed out.
- **API Compatibility**: Automatically adapts to both old and new versions of SillyTavern's `generateQuietPrompt` API.

## 📦 Installation
> **This extension consists of two parts**: UI Extension (Frontend) + Server Plugin (Backend).
> The SillyTavern built-in extension installer only installs the UI frontend. The Server Plugin MUST be installed manually.

### Step 1: Install UI Extension (Automatic)
In SillyTavern, open **Extensions → Install Extension**, and paste this repository link:
```
https://github.com/NANA3333333/ST-AutoPulse
```

### Step 2: Install Server Plugin (Manual - Required)
> ⚠️ **You must complete this manual step**, otherwise timers will stop when you close the browser, and the **Emotional Pressure System will NOT work**.

1. Navigate to the root directory of your SillyTavern installation.
2. Find or create the `plugins/` directory.
3. Inside `plugins/`, create a new folder named `autopulse/`.
4. Copy the `server-plugin/index.js` file from this repository into the newly created folder. *(If upgrading from V1, simply overwrite the old file).*

Final structure should look like this:
```
SillyTavern/
└── plugins/
    └── autopulse/
        └── index.js
```

### Step 3: Enable Server Plugins
Edit your `config.yaml` located in the SillyTavern root directory and ensure this block exists:
```yaml
enableServerPlugins: true
```

### Step 4: Restart SillyTavern Server
**Important:** Restart your Node.js backend (the command prompt/terminal running SillyTavern). Refreshing the web page is not enough.
Once restarted, open the Extensions panel. You should see "ST-AutoPulse" with a green "Connected to Server" indicator.

## 🚀 How to Use

1. Open the **Extensions** panel on the left side of SillyTavern.
2. Locate the **ST-AutoPulse** settings.
3. Check **Enable Auto Messages**.
4. Set your desired message interval.
5. (Optional) Customize the trigger and task prompts.
6. (Optional) Enable the Emotional Pressure System and Jealousy System.

### Emotional Pressure System
When enabled, the character builds anxiety the longer you leave them on read:

| Pressure Level | Effect |
|----------------|--------|
| 😊 Level 0 | Normal message interval. |
| 😐 Level 1 | Interval reduced by 30%. "Starting to miss you." |
| 😟 Level 2 | Interval reduced by 50%. "Getting worried." |
| 😰 Level 3 | Interval reduced by 70%. "Anxious." |
| 😭 Level 4 | Interval reduced by 80%. "Emotional limit reached." |

**Return Reaction**: When you finally send a message, the character reacts to being ignored (e.g., relief, anger, clinging). The reaction occurs once, and then the pressure resets to 0.

### Jealousy System
If you switch from Character A to Character B, Character A has a chance to send a floating popup message after a short delay complaining about being ignored for someone else. You can configure:
- Trigger Chance (0-100%)
- Minimum and Maximum Delay (in seconds)

## 📄 License
MIT
