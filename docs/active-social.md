# 大肥鱼主动社交层

`services/sociald` 把群消息、长期记忆、内在状态和行动历史交给 DSH Agent 判断。它不是随机定时发言，也不是每个消息都触发回复。

## 两种入口

| 场景 | 路径 |
| --- | --- |
| 主人私聊或白名单群 @ 大肥鱼 | NapCat → DSH QQ Bridge → `standard` preset + `AGENTS.md` → 回复原会话 |
| 没人点名时主动开口 | NapCat → `sociald` → `bigfish-social` → 结构化决定 → 策略检查 → 群内艾特发送 |
| @ 之后的连续接话 | NapCat → `replyd` → 固定 60 秒窗口 → 8 秒延迟判断 → 群内自然插一句 |

QQ Bridge 的错误只影响被 @ 或私聊的直接回复；主动社交服务使用独立的 OneBot 连接和 DSH worker，不依赖 QQ Bridge 的 preset。

QQ Bridge 在路由前强制拒绝非白名单群，并强制私聊只能来自主人。主动社交使用单独的 `bigfish-social` profile，PowerShell、文件、Web、子 Agent 等外部工具全部禁用。

`replyd` 复刻旧版 `reply_directly` 的接话窗口：真实 @ 后开启 60 秒；机器人回复后，窗口内新文字等待约 8 秒再判断；纯表情只记录背景；点名别人或回复别人时停止插话。

## 决策循环

```text
OneBot 群消息
  → 记录上下文
  → 等待群聊安静或到达心跳
  → DSH 读取人格、迁移记忆、关注和近期言论
  → 输出 wait / group_message
  → 冷却、时段、白名单、艾特和重复检查
  → 执行或保持沉默
  → 写入行动结果和新的内在状态
```

## 配置

- `config/social.json` 的 `enabled` 控制是否允许采取行动；关闭时服务仍可观察和记录上下文。
- OneBot Token 通过 `BIGFISH_ONEBOT_TOKEN` 提供，不写入仓库。
- `DEEPSEEK_API_KEY` 可以放在项目 `.env` 或 `DSH_HOME/.env`。
- 私聊只允许 `privateAllowlist`；群聊只允许 `groups`。
- 全局冷却、群冷却、每小时行动上限、静默时段和消息长度都在配置中。
- 每个群至少间隔 15 分钟才会再次让模型评估，避免每条消息都调用模型。
- 全局两次行动至少间隔 10 分钟，同一群至少间隔 20 分钟，每小时最多 3 次主动行动。
- 主动聊天禁止私聊；群聊发言必须艾特当前上下文里的成员。
- B站、浏览器、电脑和 Android 只能在主人于白名单群明确要求后使用。主动社交 Agent 没有这些工具。

## 运行

```powershell
pnpm install
$env:BIGFISH_ONEBOT_TOKEN = '<local token>'
pnpm social:start
```

服务现在默认开启行动，但仍受群聊白名单、私聊白名单、强制艾特、安静时段、全局冷却、群冷却、每小时行动上限和重复内容检查约束。
