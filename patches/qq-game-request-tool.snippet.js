// BIGFISH_QQ_GAME_REQUEST_TOOL
function registerBigFishGameRequestTool(ctx, cfg, officialMode) {
    if (officialMode || !ctx.tools?.register)
        return () => { };
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_request_gameplay',
        description: 'Queue an immediate autonomous gameplay session when the owner explicitly orders BigFish to play. This bypasses routine cooldown but never bypasses payment, account, privacy, or other safety limits. Do not call it for a question or ordinary game discussion.',
        parameters: {
            game: { type: 'string', description: 'Optional game name from the owner message, for example 明日方舟. Omit when the owner only says 去玩.' },
            reason: { type: 'string', required: true, description: 'The owner request and the bounded play intention, in one short sentence.' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    queued: { type: 'boolean', required: true },
                    group_id: { type: 'string', required: true },
                    game: { type: 'string' },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: `Queued gameplay request${value.game ? ` for ${value.game}` : ''} in group ${value.group_id}.`,
            }],
        },
        isConcurrencySafe: () => false,
        timeoutMs: 15000,
        async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                throw new Error('当前 QQ 会话无法解析游戏请求目标');
            const [scope, target] = String(sessionKey).split(':', 2);
            const groupId = Number(target);
            if (scope !== 'group' || !Number.isFinite(groupId))
                throw new Error('自动游戏请求只允许从白名单群发起');
            const allowedGroups = String(process.env.BIGFISH_ALLOWED_GROUPS || '')
                .split(',').map((value) => value.trim()).filter(Boolean);
            if (!allowedGroups.includes(String(groupId)))
                throw new Error('当前群不在自动游戏白名单');
            // BIGFISH_QQ_OWNER_CONTEXT
            // The live DSH session does not expose the current user message in
            // session.events at tool execution time. The executor records the
            // platform-derived owner flag for this session before delivery.
            const isOwner = globalThis.__bigfishQqOwnerBySession?.get(sessionId) === true;
            if (!isOwner)
                throw new Error('只有主人本人明确要求时才能触发自动游戏');
            const [{ mkdir, rename, writeFile }, { dirname, resolve }] = await Promise.all([
                import('node:fs/promises'),
                import('node:path'),
            ]);
            const projectRoot = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
            const requestPath = resolve(projectRoot, 'data', 'mumud', 'request.json');
            await mkdir(dirname(requestPath), { recursive: true });
            const request = {
                version: 1,
                requestedAt: new Date().toISOString(),
                scope,
                groupId: String(groupId),
                isOwner: true,
                game: args.game?.trim() || null,
                reason: String(args.reason).trim().slice(0, 1000),
            };
            const temporary = `${requestPath}.tmp`;
            await writeFile(temporary, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
            await rename(temporary, requestPath);
            return { queued: true, group_id: String(groupId), ...(request.game ? { game: request.game } : {}) };
        },
    }));
    console.info('[bigfish-game] bigfish_request_gameplay registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
