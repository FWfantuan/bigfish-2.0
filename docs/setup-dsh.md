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

`pnpm dsh:patch` 会把仓库 `skills/` 下的项目 Skill 同步进 QQ preset，保证本地修改经过安装后真正进入运行时，而不是只留在仓库里。

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

QQ 群聊保留完整后台排查工具，不能因为查进程、日志或 ADB 就一直沉默。当前 profile 关闭了固定的 `agent.progress.messages`，避免“我在翻后台”一类模板反复出现。长任务应在需要说明时结合正在查的具体内容自然回复；`agent.timeoutMs` 仍限制单轮时长。

QQ 群聊模型使用已声明图片输入的 `deepseek-v4-flash-vision-exp`。收到 OneBot 图片段时，Bridge 会下载最多 6 张、单张不超过 12 MiB 的图片到 `data/qq-images`，把本地路径附加给 Agent；Agent 必须先调用 `read_image`，不能根据 `[图片]` 猜内容。

```yaml
agent:
  preset: standard
  timeoutMs: 180000
  timeoutMessage: 我这边卡住了，再艾特我一下
  progress:
    messages: []
```

`bigfish_share_screenshot` 是主人授权的直接截图工具。在白名单群的主人会话或主人私聊里，大肥鱼判断需要展示当前屏幕时可以直接调用；工具会截取在线 ADB 设备并发送到当前会话，不再弹二次确认。非主人请求、非白名单群和发往其他私聊的调用会被拒绝。

QQ Bridge 还会把白名单群最近 24 条消息持久化到 `data/qq-history.json`。被艾特时会注入最近 12 条原文，并与 Brain 中重启前保留的最近 QQ 回合合并，因此 DSH 重启后仍能理解“上文在说什么”。

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
