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

普通技能的触发条件重复出现两次后，从 `candidate` 升为 `active`。之后的主动社交和 QQ 对话都会看到这些技能。

`arknights_roguelike` 技能使用更严格的晋升条件：至少五条观察证据、三次成功，并且成功率不低于 60%。只到主题页、没有开始探索或战斗的 MAA 结果会标记为无效样本，不参与技能晋升。

目标写入采用 upsert：复盘器优先复用已有目标 ID，并按规范化标题关闭重复条目。`POST /v1/goals` 也不会再无条件新建，而是合并到相同目标。`POST /v1/goals/dedupe?scope=...` 可清理历史遗留的重复目标。

## 工具审批

主动社交 Agent 没有外部工具。它需要 B站、浏览器、电脑或手机时，只能生成 `request_tool`，在允许的群内艾特主人并创建 Brain approval。

主人在白名单群真实艾特机器人表示同意后，approval 变成 `approved`。QQ Bridge 的群会话才能使用相应工具；执行完成后，工具结果写回 Brain 并自动复盘。

普通事实搜索是例外：`sociald`、`replyd` 和私聊 Agent 可以直接调用 DeepSeek `web_search`，但配置为 `fetch: false`，不能打开网页或抓取全文。小说、漫画、长文阅读和视频播放仍必须经过工具审批。

获批后的 QQ 视频查看可以调用 `bigfish_send_bili_frames`。该工具默认只抽一张
JPEG 画面并以 QQ 图片消息发回当前白名单群或主人私聊；只有主人明确要求多张
时才增加。分 P 和点名时间分别通过 `page`、`timestamp_seconds` 传入。未指定
时间时从该分 P 约 40% 位置取代表性画面。MJPEG 输出显式转换成 full-range
YUV，规避部分 B站视频触发编码器的色彩范围错误。只能发送
`data/media/frames` 中由抽帧器生成的文件。

## 启动

```powershell
pnpm brain:seed
pnpm brain:start
pnpm dsh:web
pnpm social:start
pnpm reply:start
```

正常重启使用 `scripts/start-dsh-stack.ps1`。
