// BIGFISH_QQ_FRAMES_TOOL
function registerBigFishFramesTool(ctx, client, cfg, officialMode) {
    if (officialMode || !ctx.tools?.register)
        return () => { };
    const frameRoot = resolve(process.env.BIGFISH_PROJECT_ROOT || process.cwd(), 'data', 'media', 'frames');
    void frameRoot;
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_send_bili_frames',
        description: 'Extract one real keyframe from a Bilibili video and send it to the current QQ group or owner private chat. Send multiple images only when the owner explicitly asks for more than one.',
        parameters: {
            bvid: { type: 'string', required: true, description: 'Bilibili BV id, for example BV1fwnv6nEYb.' },
            count: { type: 'number', description: 'Number of frames, 1-6. Default 1; use more only when the owner explicitly requests multiple images.' },
            page: { type: 'number', description: 'Optional Bilibili part/page number, starting at 1. Use the exact P the owner names.' },
            timestamp_seconds: { type: 'number', description: 'Optional exact timestamp in seconds, covering the entire video or selected part. Use this when the owner names a time.' },
            caption: { type: 'string', description: 'Optional short text sent after the images.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sent: { type: 'boolean', required: true },
                    bvid: { type: 'string', required: true },
                    title: { type: 'string', required: true },
                    count: { type: 'number', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `Sent ${value.count} Bilibili keyframe(s): ${value.title}` }],
        },
        isConcurrencySafe: () => false,
        timeoutMs: 180000,
        async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                throw new Error('当前 QQ 会话无法解析发送目标');
            const [scope, target] = String(sessionKey).split(':', 2);
            const targetId = Number(target);
            if (!Number.isFinite(targetId))
                throw new Error('当前 QQ 会话目标无效');
            if (scope === 'private' && targetId !== Number(cfg.access.adminQq))
                throw new Error('私聊图片只允许发送给主人');
            if (scope === 'group') {
                const allowedGroups = String(process.env.BIGFISH_ALLOWED_GROUPS || '')
                    .split(',').map((value) => value.trim()).filter(Boolean);
                if (!allowedGroups.includes(String(targetId)))
                    throw new Error('当前群不在图片发送白名单');
            }
            const projectRoot = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
            const moduleUrl = pathToFileURL(resolve(projectRoot, 'services/media/bili-frames.mjs')).href;
            const { extractBilibiliFrames } = await import(moduleUrl);
            const result = await extractBilibiliFrames({
                bvid: String(args.bvid),
                count: Math.max(1, Math.min(6, Number(args.count || 1))),
                page: Math.max(1, Math.trunc(Number(args.page || 1))),
                timestampSeconds: Number.isFinite(Number(args.timestamp_seconds))
                    ? Number(args.timestamp_seconds)
                    : null,
            });
            const message = [];
            for (const frame of result.frames) {
                const data = await readFile(frame);
                message.push({ type: 'image', data: { file: `base64://${data.toString('base64')}` } });
            }
            if (args.caption?.trim())
                message.push({ type: 'text', data: { text: `\n${String(args.caption).trim().slice(0, 500)}` } });
            if (scope === 'private')
                await client.sendPrivate(targetId, message);
            else
                await client.sendGroup(targetId, message);
            return {
                sent: true,
                bvid: result.bvid,
                title: result.title,
                count: result.frames.length,
            };
        },
    }));
    console.info('[bigfish-frames] bigfish_send_bili_frames registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
