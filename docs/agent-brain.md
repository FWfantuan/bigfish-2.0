# Unified BigFish Brain

`services/brain` 是大肥鱼的统一持续状态，监听本机 `127.0.0.1:15621` 并持久化到 SQLite。

## 保存内容

- 当前心情、关注点和愿望
- 群聊、机器人行动和工具调用事件
- 长期事实
- 目标队列
- 行动结果
- 经历复盘
- 候选和已启用技能
- 工具权限审批

## 数据流

```text
QQ 直聊 / replyd / sociald
  → 读取统一上下文
  → DSH 决定
  → QQ、B站、浏览器、电脑或 Android 工具
  → 写回行动和工具结果
  → 15 秒后复盘
  → 新事实、目标和技能候选
```

同一技能的触发条件重复出现两次后，从 `candidate` 升为 `active`。之后的主动社交和 QQ 对话都会看到这些技能。

## 工具审批

主动社交 Agent 没有外部工具。它需要 B站、浏览器、电脑或手机时，只能生成 `request_tool`，在允许的群内艾特主人并创建 Brain approval。

主人在白名单群真实艾特机器人表示同意后，approval 变成 `approved`。QQ Bridge 的群会话才能使用相应工具；执行完成后，工具结果写回 Brain 并自动复盘。

普通事实搜索是例外：`sociald`、`replyd` 和私聊 Agent 可以直接调用 DeepSeek `web_search`，但配置为 `fetch: false`，不能打开网页或抓取全文。小说、漫画、长文阅读和视频播放仍必须经过工具审批。

获批后的 QQ 视频查看可以调用 `bigfish_send_bili_frames`。该工具默认只抽一张 JPEG 关键帧并以 QQ 图片消息发回当前白名单群或主人私聊；只有主人明确要求多张时才增加。只能发送 `data/media/frames` 中由抽帧器生成的文件。

## 启动

```powershell
pnpm brain:seed
pnpm brain:start
pnpm dsh:web
pnpm social:start
pnpm reply:start
```

正常重启使用 `scripts/start-dsh-stack.ps1`。
