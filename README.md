# 大肥鱼 2.0

大肥鱼 2.0 使用 DeepSeek Harness（DSH）作为 Agent 主机，目标是具备持续状态、记忆、目标、主动发言和真实设备操作能力。旧 AstrBot、BigFish Core 和旧语音服务已经停止，NapCat 作为 QQ 连接层保留。

当前 `dev` 分支已经包含：

- DSH 0.1.7 的独立 Web profile 和 headless worker profile
- NapCat / OneBot QQ Bridge，状态、审批和主动提醒
- B站搜索、视频元数据、字幕、播放地址和抽帧
- Playwright 浏览器，使用独立持久 Edge profile
- Cua Driver 原生桌面控制，可枚举应用、观察窗口、点击、输入、滚动和拖拽
- Android ADB 控制，支持设备发现、截图、UI 树、点击、输入、应用启动和日志
- 主动社交服务：群聊观察、人格状态、长期记忆、行动理由、冷却和主动艾特
- 旧版 60 秒接话窗口：真实 @ 后的连续对话、8 秒延迟自然插话，纯表情不触发回复
- 旧 AstrBot 人格卡、122 条 LivingMemory 和 108 个成员身份已迁移到本地私有记忆
- Unified Brain：统一目标、关注点、长期事实、工具结果、复盘、技能和审批
- B站观看/评论与设备控制 Skills

## 结构

```text
QQ / 定时触发
      ↓
主动社交服务 ─────→ DSH worker
      ↓                 ├─ B站工具
QQ / NapCat            ├─ 浏览器
      ↑                 ├─ Windows 桌面
      └─────────────────└─ Android
```

## 常用命令

```powershell
pnpm install
pnpm dsh:patch
pnpm brain:seed
./scripts/start-dsh-stack.ps1
pnpm dsh:web
pnpm dsh:worker
pnpm social:start
pnpm reply:start
pnpm social:test
```

模型密钥和 OneBot Token 保存在本机 `DSH_HOME/.env`，不进入 Git。

## 文档

- [迁移到 DSH](docs/migration-to-dsh.md)
- [主动社交层](docs/active-social.md)
- [人格与记忆迁移](docs/memory-migration.md)
- [统一 Agent Brain](docs/agent-brain.md)

## 旧 AstrBot 命令

以下命令属于已停用的旧体系，保留在历史代码中供迁移参考。

```text
agent状态
agent暂停
agent恢复
agent记住 内容
agent记忆
agent目标 目标内容
agent任务
agent完成 任务编号
```

后续的新能力优先实现为 DSH 工具、Skill 或本地能力服务。

## 开发约定

日常开发在 `dev` 分支进行。提交前至少运行 Python 语法检查，并保留可回滚的提交记录。
