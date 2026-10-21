from __future__ import annotations

import json
import sqlite3
import time
from pathlib import Path

from astrbot.api import logger
from astrbot.api.event import AstrMessageEvent, filter
from astrbot.api.star import Star, StarTools, register


OWNER = "2440298506"


class AgentStore:
    def __init__(self, root: Path):
        root.mkdir(parents=True, exist_ok=True)
        self.path = root / "agent.sqlite3"
        self.state_path = root / "agent_state.json"
        with sqlite3.connect(self.path) as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY, scope TEXT, content TEXT, created REAL)"
            )
            db.execute("CREATE INDEX IF NOT EXISTS memories_scope ON memories(scope, created DESC)")
            db.execute(
                "CREATE TABLE IF NOT EXISTS tasks (id INTEGER PRIMARY KEY, scope TEXT, title TEXT, status TEXT, created REAL, updated REAL)"
            )
        if not self.state_path.exists():
            self._write_state({"enabled": True, "autonomous_mode": "observe", "last_action": 0})

    def _read_state(self):
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {"enabled": False, "autonomous_mode": "observe", "last_action": 0}

    def _write_state(self, value):
        tmp = self.state_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(self.state_path)

    def state(self):
        return self._read_state()

    def update(self, **changes):
        state = self._read_state()
        state.update(changes)
        self._write_state(state)
        return state

    def remember(self, scope: str, content: str):
        with sqlite3.connect(self.path) as db:
            db.execute(
                "INSERT INTO memories(scope, content, created) VALUES (?, ?, ?)",
                (scope[:120], content[:4000], time.time()),
            )

    def recent(self, scope: str, limit: int = 8):
        with sqlite3.connect(self.path) as db:
            rows = db.execute(
                "SELECT content FROM memories WHERE scope=? ORDER BY created DESC LIMIT ?",
                (scope[:120], max(1, min(limit, 32))),
            ).fetchall()
        return [row[0] for row in rows]

    def add_task(self, scope: str, title: str):
        now = time.time()
        with sqlite3.connect(self.path) as db:
            cur = db.execute(
                "INSERT INTO tasks(scope, title, status, created, updated) VALUES (?, ?, 'open', ?, ?)",
                (scope[:120], title[:500], now, now),
            )
            return int(cur.lastrowid)

    def tasks(self, scope: str, limit: int = 10):
        with sqlite3.connect(self.path) as db:
            rows = db.execute(
                "SELECT id, title, status FROM tasks WHERE scope=? ORDER BY updated DESC LIMIT ?",
                (scope[:120], max(1, min(limit, 32))),
            ).fetchall()
        return rows

    def finish_task(self, scope: str, task_id: int):
        with sqlite3.connect(self.path) as db:
            cur = db.execute(
                "UPDATE tasks SET status='done', updated=? WHERE scope=? AND id=? AND status='open'",
                (time.time(), scope[:120], task_id),
            )
        return cur.rowcount > 0


@register("astrbot_plugin_bigfish_agent", "local", "大肥鱼 2.0 Agent 基础层", "0.1.0")
class BigFishAgent(Star):
    def __init__(self, context):
        super().__init__(context)
        self.store = AgentStore(Path(StarTools.get_data_dir()))
        logger.info("[大肥鱼 Agent] 基础层已加载，当前为 observe 安全模式")

    def _owner(self, event):
        return str(event.get_sender_id()) == OWNER

    @filter.command("agent状态")
    async def agent_status(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        state = self.store.state()
        memories = sum(1 for _ in self.store.recent("global", 32))
        yield event.plain_result(
            "大肥鱼 2.0 Agent\n"
            f"核心：已加载\n启用：{state.get('enabled', False)}\n"
            f"模式：{state.get('autonomous_mode', 'observe')}\n"
            f"全局记忆：{memories} 条\n"
            "当前只观察和记录，不会自动发帖、退群或操作电脑。"
        )

    @filter.command("agent暂停")
    async def agent_pause(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        self.store.update(enabled=False, autonomous_mode="paused")
        yield event.plain_result("大肥鱼 Agent 已暂停主动任务。")

    @filter.command("agent恢复")
    async def agent_resume(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        self.store.update(enabled=True, autonomous_mode="observe")
        yield event.plain_result("大肥鱼 Agent 已恢复，当前为 observe 观察模式。")

    @filter.command("agent记住")
    async def agent_remember(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        text = str(event.message_str or "").strip()
        content = text[len("agent记住") :].strip()
        if not content:
            yield event.plain_result("用法：agent记住 内容")
            return
        scope = str(event.get_group_id() or "global")
        self.store.remember(scope, content)
        yield event.plain_result("已记住。")

    @filter.command("agent记忆")
    async def agent_memory(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        scope = str(event.get_group_id() or "global")
        memories = self.store.recent(scope)
        if not memories:
            yield event.plain_result("这个范围还没有 Agent 记忆。")
            return
        yield event.plain_result("最近记忆：\n" + "\n".join(f"{i}. {x}" for i, x in enumerate(reversed(memories), 1)))

    @filter.command("agent目标")
    async def agent_goal(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        text = str(event.message_str or "").strip()
        title = text[len("agent目标") :].strip()
        if not title:
            yield event.plain_result("用法：agent目标 目标内容")
            return
        scope = str(event.get_group_id() or "global")
        task_id = self.store.add_task(scope, title)
        yield event.plain_result(f"已加入 Agent 目标 #{task_id}：{title}")

    @filter.command("agent任务")
    async def agent_tasks(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        scope = str(event.get_group_id() or "global")
        tasks = self.store.tasks(scope)
        if not tasks:
            yield event.plain_result("当前没有任务。")
            return
        yield event.plain_result(
            "当前任务：\n" + "\n".join(f"#{task_id} [{status}] {title}" for task_id, title, status in tasks)
        )

    @filter.command("agent完成")
    async def agent_finish(self, event: AstrMessageEvent):
        if not self._owner(event):
            return
        text = str(event.message_str or "").strip()
        raw_id = text[len("agent完成") :].strip()
        try:
            task_id = int(raw_id.lstrip("#"))
        except ValueError:
            yield event.plain_result("用法：agent完成 任务编号")
            return
        scope = str(event.get_group_id() or "global")
        if self.store.finish_task(scope, task_id):
            yield event.plain_result(f"任务 #{task_id} 已完成。")
        else:
            yield event.plain_result(f"找不到范围内仍开放的任务 #{task_id}。")

    @filter.event_message_type(filter.EventMessageType.GROUP_MESSAGE, priority=1800)
    async def observe_group_message(self, event: AstrMessageEvent):
        state = self.store.state()
        group = str(event.get_group_id() or "")
        if not group or not state.get("enabled") or state.get("autonomous_mode") != "observe":
            return
        text = str(event.message_str or "").strip()
        if text:
            self.store.remember(group, f"{event.get_sender_name() or event.get_sender_id()}: {text}")
        if False:
            yield None
