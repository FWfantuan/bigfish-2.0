# DSH profile 配置

大肥鱼使用四个 profile：

- `bigfish017`：Web profile，承载 QQ Bridge 和 B站插件。
- `bigfish-worker`：headless profile，承载主动社交、B站、浏览器、桌面和 Android 工具。
- `bigfish-social`：无外部工具的社交推理 profile，只负责主动聊天和接话判断。
- `bigfish-play`：隔离的自动游戏 profile，只挂 Android ADB 工具，使用带视觉输入的 DeepSeek 模型。

固定 DSH 版本为 `0.1.7-rc.2`。最新版 DSH 与当前 QQ Bridge 客户端依赖不兼容。

```powershell
pnpm add -D @deepseek-ai/dsh@0.1.7-rc.2
pnpm dsh:patch
```

`bigfish017` 的插件：

```text
@yachangchang/dsh-qq-bridge 1.0.6
dsh-plugin-bilibili 0.2.1
@yeesy369/dsh-browser-playwright 0.8.1
@yeesy369/dsh-tool-browser 0.7.0
@zseven-w/dsh-android 0.1.0-rc.12
@deepseek-ai/dsh-computer-use 0.1.6-alpha.1
@deepseek-ai/dsh-experimental-computer-use-cua-driver-native 0.1.6-alpha.1
```

`bigfish-worker` 的插件：

```text
dsh-plugin-bilibili 0.2.1
@yeesy369/dsh-browser-playwright 0.8.1
@yeesy369/dsh-tool-browser 0.7.0
@zseven-w/dsh-android 0.1.0-rc.12
@deepseek-ai/dsh-computer-use 0.1.6-alpha.1
@deepseek-ai/dsh-experimental-computer-use-cua-driver-native 0.1.6-alpha.1
```

`bigfish-play` 的插件：

```text
@zseven-w/dsh-android 0.1.0-rc.12
```

它的默认模型是 `deepseek-v4-flash-vision-exp`。`pnpm dsh:patch` 会幂等检查
`bigfish-play/cordis.patch.yml`，在该模型的目录项中声明
`inputModalities: [text, image]`；缺少这个声明时 Android 截图只能返回 JSON
摘要，Agent 看不到画面。

本机环境文件需要包含：

```text
DEEPSEEK_API_KEY=...
BIGFISH_ONEBOT_TOKEN=...
BIGFISH_BRAIN_URL=http://127.0.0.1:15621
BIGFISH_BRAIN_TOKEN=...
BIGFISH_BOT_QQ=<机器人 QQ>
BIGFISH_OWNER_QQ=<主人 QQ>
BIGFISH_ALLOWED_GROUPS=<群号1>,<群号2>
ADB=D:\MuMuPlayer\nx_device\12.0\shell\adb.exe
```

NapCat 只保留一个绑定 `127.0.0.1:3001` 的正向 WebSocket server。旧 AstrBot 反向 WebSocket 已移除，避免两套 Agent 同时消费 QQ 消息。

电脑重启后运行：

```powershell
pnpm dsh:patch
./scripts/start-dsh-stack.ps1
```

`pnpm dsh:patch` 应用两个当前社区的兼容修正：

- DSH 0.1.7 headless profile 没有完整 settings 服务时，Browser Provider 直接使用 profile 配置。
- QQ Bridge 的 settings scope 首次挂载未触发 onChange 时，使用 profile 配置启动一次。
