import WebSocket from "ws";

function textOfSegments(message) {
  if (typeof message === "string") return message;
  if (!Array.isArray(message)) return "";
  return message
    .map((part) => {
      if (part.type === "text") return part.data?.text || "";
      if (part.type === "at") return `@${part.data?.qq || ""} `;
      if (part.type === "image") return "[图片]";
      if (part.type === "face") return "[表情]";
      return "";
    })
    .join("")
    .trim();
}

export class OneBotConnection {
  constructor({ url, token, onMessage, onStatus }) {
    this.url = url;
    this.token = token;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.ws = null;
    this.connected = false;
    this.pending = new Map();
    this.retry = null;
    this.attempt = 0;
    this.closed = false;
  }

  connect() {
    if (this.closed) return;
    const headers = this.token ? { Authorization: `Bearer ${this.token}` } : undefined;
    const ws = new WebSocket(this.url, { headers });
    this.ws = ws;
    ws.on("open", () => {
      this.connected = true;
      this.attempt = 0;
      this.onStatus?.({ kind: "connected" });
    });
    ws.on("message", (raw) => {
      let frame;
      try {
        frame = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (frame.echo && this.pending.has(frame.echo)) {
        const pending = this.pending.get(frame.echo);
        clearTimeout(pending.timer);
        this.pending.delete(frame.echo);
        pending.resolve(frame);
        return;
      }
      if (frame.post_type === "message") {
        const groupId = frame.message_type === "group" ? String(frame.group_id) : null;
        const senderId = String(frame.user_id || frame.sender?.user_id || "");
        this.onMessage?.({
          groupId,
          senderId,
          senderName: frame.sender?.card || frame.sender?.nickname || senderId,
          text: textOfSegments(frame.message),
          raw: frame,
          at: Date.now(),
        });
      }
    });
    ws.on("close", () => {
      this.connected = false;
      this.onStatus?.({ kind: "disconnected" });
      this.schedule();
    });
    ws.on("error", (error) => this.onStatus?.({ kind: "error", message: error.message }));
  }

  schedule() {
    if (this.closed || this.retry) return;
    this.attempt += 1;
    const delay = Math.min(1000 * 2 ** this.attempt, 15000);
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, delay);
  }

  async action(action, params) {
    if (!this.connected || this.ws?.readyState !== WebSocket.OPEN) throw new Error("OneBot is not connected");
    const echo = `social-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(echo);
        reject(new Error(`OneBot action timed out: ${action}`));
      }, 10000);
      this.pending.set(echo, { resolve, reject, timer });
    });
    this.ws.send(JSON.stringify({ action, params, echo }));
    const frame = await response;
    if (frame.status !== "ok" || frame.retcode !== 0) {
      throw new Error(`OneBot action failed: ${action} retcode=${frame.retcode}`);
    }
    return frame.data;
  }

  async sendGroup(groupId, text, mentionQq = null) {
    const message = [];
    if (mentionQq) {
      message.push({ type: "at", data: { qq: String(mentionQq) } }, { type: "text", data: { text: " " } });
    }
    message.push({ type: "text", data: { text } });
    return this.action("send_group_msg", { group_id: Number(groupId), message });
  }

  async sendPrivate(userId, text) {
    return this.action("send_private_msg", { user_id: Number(userId), message: text });
  }

  close() {
    this.closed = true;
    if (this.retry) clearTimeout(this.retry);
    for (const { timer, reject } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("OneBot connection closed"));
    }
    this.pending.clear();
    this.ws?.close();
  }
}

export { textOfSegments };
