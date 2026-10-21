# DSH profile 配置

大肥鱼使用两个 profile：

- `bigfish017`：Web profile，承载 QQ Bridge 和 B站插件。
- `bigfish-worker`：headless profile，承载主动社交、B站、浏览器、桌面和 Android 工具。

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

本机环境文件需要包含：

```text
DEEPSEEK_API_KEY=...
BIGFISH_ONEBOT_TOKEN=...
BIGFISH_BOT_QQ=1844465930
BIGFISH_OWNER_QQ=2440298506
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
