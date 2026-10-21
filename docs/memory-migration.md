# 旧记忆与人格迁移

旧的 AstrBot 数据已经转换为 DSH 可读取的本地私有档案：

- `data/memory/persona_source.md`：原始角色卡
- `data/memory/livingmemory.md`：122 条 LivingMemory 长期记忆
- `data/memory/member_profiles.md`：群成员、别名和已绑定游戏角色

`data/` 已被 Git 忽略，这些文件只保存在本机，不会推送公开仓库。`AGENTS.md` 规定 DSH 在相关对话中先检索这些档案，再回答人物、关系和历史问题。

`AGENTS.md` 同时包含大肥鱼的说话风格、主人权限、白名单群、主动聊天和工具使用规则。QQ Bridge、主动社交和 headless worker 都从同一个工作目录读取它。
