// BIGFISH_QQ_MEME_TOOL
function registerBigFishMemeTool(ctx, client, cfg, officialMode) {
    if (officialMode || !ctx.tools?.register)
        return () => { };
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_send_meme',
        description: 'Send one local meme image to the current QQ group. Use for an explicit request such as 发个表情包 or 来只奶龙; do not send memes during ordinary replies unless the user asks or the context clearly calls for one.',
        parameters: {
            kind: { type: 'string', description: 'Meme collection: nailong for 奶龙, meme for the general meme collection. Defaults to nailong when the user says 奶龙.' },
            caption: { type: 'string', description: 'Optional short caption; keep it natural and under 80 characters.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: { sent: { type: 'boolean', required: true }, kind: { type: 'string', required: true }, file: { type: 'string', required: true } },
            },
            render: (_args, value) => [{ type: 'text', text: `已发送${value.kind === 'nailong' ? '奶龙' : '表情包'}：${value.file}` }],
        },
        isConcurrencySafe: () => false,
        timeoutMs: 30_000,
        async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                throw new Error('当前 QQ 会话无法解析发送目标');
            const [scope, target] = String(sessionKey).split(':', 2);
            const targetId = Number(target);
            if (scope !== 'group' || !Number.isFinite(targetId))
                throw new Error('表情包只允许发送到白名单群');
            const allowedGroups = String(process.env.BIGFISH_ALLOWED_GROUPS || '').split(',').map((value) => value.trim()).filter(Boolean);
            if (!allowedGroups.includes(String(targetId)))
                throw new Error('当前群不在图片发送白名单');
            const root = resolve(process.env.BIGFISH_MEME_ROOT || resolve(process.env.BIGFISH_PROJECT_ROOT || process.cwd(), 'data', 'memes'));
            const requested = String(args.kind || '').toLowerCase();
            const kind = requested.includes('奶龙') || requested === 'nailong' ? 'nailong' : 'meme';
            const directory = resolve(root, kind);
            const entries = (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isFile() && /\.(gif|png|jpe?g|webp|bmp)$/i.test(entry.name));
            if (!entries.length)
                throw new Error(`本地${kind === 'nailong' ? '奶龙' : '表情包'}库为空`);
            const entry = entries[Math.floor(Math.random() * entries.length)];
            const bytes = await readFile(resolve(directory, entry.name));
            const message = [{ type: 'image', data: { file: `base64://${bytes.toString('base64')}` } }];
            if (String(args.caption || '').trim())
                message.push({ type: 'text', data: { text: `\n${String(args.caption).trim().slice(0, 80)}` } });
            await client.sendGroup(targetId, message);
            return { sent: true, kind, file: entry.name };
        },
    }));
    console.info('[bigfish-meme] bigfish_send_meme registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
