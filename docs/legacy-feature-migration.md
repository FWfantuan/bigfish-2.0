# 旧大肥鱼功能迁移清单

这份清单把旧 AstrBot 插件逐项迁到 DSH，不把旧插件整包搬回来。每项能力都先做只读适配和回归测试，再开放会产生外部影响的操作。

| 旧能力 | 现在的承接位置 | 状态 | 迁移顺序 |
| --- | --- | --- | --- |
| 人格、群成员、长期记忆 | `services/brain`、本地 `data/memory`、QQ Bridge 上下文 | 已迁移 | — |
| 目标、主动性、自学习复盘 | `services/brain/consolidator.mjs`、`services/sociald`、`services/mumud` | 已迁移 | — |
| 直接回复、60 秒接话窗口 | `services/replyd`、QQ Bridge | 已迁移 | — |
| B 站搜索、字幕、关键帧 | QQ Bridge patches、B 站 media service | 已迁移 | — |
| Android / MuMu 控制 | `services/mumud`、DSH Android tools | 已迁移 | — |
| 明日方舟普通战斗与肉鸽 | `services/mumud`、MAA Copilot | 已迁移并持续实测 | — |
| FF14 鱼窗、PVP、主线、Wiki、乐谱、官方图片 | 旧 `astrbot_plugin_ff14_companion` | 待迁移 | 第一批，只读 |
| FFLogs、房屋、市场、幻化 | 旧 FF14/Tataru/FFLogs 插件 | 待迁移 | 第二批，只读 |
| MaaEnd 设备、登录、任务控制 | 旧 `astrbot_plugin_bigfish_maaend` | 待迁移 | 第三批，先查询后执行 |
| 终末地查询与账号能力 | 旧 `astrbot_plugin_endfield` | 待迁移 | 第四批，先只读 |
| 梗图、表情包、语音 | 旧 meme/nailong/voice 相关插件 | 待迁移 | 第五批 |

迁移规则：每一批独立提交；先接入 DSH Skill 和只读工具；工具结果必须有真实返回才播报成功；旧入口保留回退点；未完成的能力不在提示词里假装已经支持。

第一批从 FF14 公开只读查询开始，先迁鱼窗和 PVP 轮换，再迁主线/Wiki/乐谱/官方图片。完成后再接需要账号或外部写入的能力。
