# 大肥鱼主动社交层

`services/sociald` 把群消息、长期记忆、内在状态和行动历史交给 DSH Agent 判断。它不是随机定时发言，也不是每个消息都触发回复。

## 两种入口

| 场景 | 路径 |
| --- | --- |
| 群友 @ 大肥鱼或私聊 | NapCat → DSH QQ Bridge → DSH `standard` preset → 回复原会话 |
| 没人点名时主动开口 | NapCat → `sociald` → DSH worker → 结构化决定 → 策略检查 → 发送 |

QQ Bridge 的错误只影响被 @ 或私聊的直接回复；主动社交服务使用独立的 OneBot 连接和 DSH worker，不依赖 QQ Bridge 的 preset。

## 决策循环

```text
OneBot 群消息
  → 记录上下文
  → 等待群聊安静或到达心跳
  → DSH 读取人格、记忆、关注和近期言论
  → 输出 wait / group_message / private_message
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

## 运行

```powershell
pnpm install
$env:BIGFISH_ONEBOT_TOKEN = '<local token>'
pnpm social:start
```

服务现在默认开启行动，但仍受群聊白名单、私聊白名单、安静时段、全局冷却、群冷却、每小时行动上限和重复内容检查约束。
