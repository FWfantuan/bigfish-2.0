// BIGFISH_QQ_GAME_REQUEST_TOOL
function registerBigFishGameRequestTool(ctx, cfg, officialMode) {
    if (officialMode || !ctx.tools?.register)
        return () => { };
    const requestDisposable = ctx.tools.register(defineTool({
        name: 'bigfish_request_gameplay',
        description: 'Queue an immediate autonomous gameplay session when the owner explicitly orders BigFish to play. This bypasses routine cooldown but never bypasses payment, account, privacy, or other safety limits. Do not call it for a question or ordinary game discussion.',
        parameters: {
            game: { type: 'string', description: 'Optional exact game, mode or theme from the owner message, for example 明日方舟 黑流树海. Preserve a named roguelike theme in this field. Omit only when the owner leaves the whole choice open.' },
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
            const [{ mkdir, readFile, rename, writeFile }, { dirname, resolve }] = await Promise.all([
                import('node:fs/promises'),
                import('node:path'),
            ]);
            const projectRoot = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
            const readJson = async (path) => {
                try {
                    return JSON.parse(await readFile(path, 'utf8'));
                }
                catch {
                    return null;
                }
            };
            const state = await readJson(resolve(projectRoot, 'data', 'mumud', 'state.json'));
            const activeGroupId = String(state?.activeGroupId || state?.activeSession?.groupId || '');
            if (state?.running === true && activeGroupId && activeGroupId !== String(groupId)) {
                throw new Error('当前游戏由另一个白名单群发起，不能在当前群插队开新游戏');
            }
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
    const statusDisposable = ctx.tools.register(defineTool({
        name: 'bigfish_gameplay_status',
        description: 'Read the authoritative BigFish gameplay worker state, including the current game-agent action, recent results and latest screenshot path. Use this for owner follow-up questions while a game is queued or running. It is read-only and never operates the emulator.',
        parameters: {},
        output: {
            schema: {
                type: 'string',
            },
            render: (_args, value) => [{
                type: 'text',
                text: value,
            }],
        },
        isConcurrencySafe: () => true,
        timeoutMs: 10000,
        async execute(_args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                throw new Error('当前 QQ 会话无法解析游戏状态目标');
            const [scope, target] = String(sessionKey).split(':', 2);
            if (scope !== 'group')
                throw new Error('自动游戏状态只允许在 QQ 群会话中读取');
            const [{ readFile }, { resolve }] = await Promise.all([
                import('node:fs/promises'),
                import('node:path'),
            ]);
            const projectRoot = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
            const readJson = async (name) => {
                try {
                    return JSON.parse(await readFile(resolve(projectRoot, 'data', 'mumud', name), 'utf8'));
                }
                catch {
                    return null;
                }
            };
            const [state, status, request, activeQuestion, live] = await Promise.all([
                readJson('state.json'),
                readJson('status.json'),
                readJson('request.json'),
                readJson('question.active.json'),
                readJson('live.json'),
            ]);
            const activeSession = state?.activeSession ?? null;
            const activeGroupId = String(
                state?.activeGroupId
                || activeSession?.groupId
                || (live?.active === true ? live.groupId : '')
                || '',
            );
            if ((state?.running === true || live?.active === true) && activeGroupId && activeGroupId !== String(target)) {
                throw new Error('当前游戏由另一个白名单群发起；游戏状态只能由发起群读取');
            }
            const value = {
                group_id: String(target),
                running: state?.running === true,
                queued: Boolean(request),
                active_group_id: state?.activeGroupId ?? request?.groupId ?? null,
                requested_game: request?.game ?? null,
                request_reason: request?.reason ?? null,
                target: status?.currentTarget ?? activeSession?.target ?? null,
                phase: activeSession?.phase ?? (request ? 'queued' : state?.running ? 'running' : 'idle'),
                pending_question: activeQuestion
                    ? {
                        game: activeQuestion.game ?? null,
                        question: activeQuestion.question ?? activeQuestion.prompt ?? null,
                    }
                    : null,
                last_session: status?.lastSession
                    ? {
                        game: status.lastSession.game ?? null,
                        ok: status.lastSession.ok ?? null,
                        completed_at: status.lastSession.completedAt ?? null,
                        error: status.lastSession.error ?? null,
                    }
                    : null,
                interrupted_session: state?.interruptedSession ?? null,
                live: live
                    ? {
                        active: live.active === true,
                        session_id: live.sessionId ?? null,
                        phase: live.phase ?? null,
                        game: live.game ?? null,
                        mode: live.mode ?? null,
                        stage_name: live.stageName ?? null,
                        current_summary: live.current?.summary ?? null,
                        current_status: live.current?.status ?? null,
                        current_result: live.current?.result ?? null,
                        last_visible_text: live.lastVisibleText ?? null,
                        latest_screenshot_path: live.latestScreenshotPath || null,
                        recent_events: Array.isArray(live.recentEvents)
                            ? live.recentEvents.slice(-10)
                            : [],
                        updated_at: live.updatedAt ?? null,
                    }
                    : null,
                ownership:
                    'The bigfish-play worker owns MuMu while queued or running. Do not call android_interact, android_launch_app, or shell commands to duplicate its gameplay. Reply from this state without polling.',
            };
            return JSON.stringify(value, null, 2);
        },
    }));
    const gameplayToolGuard = typeof ctx.tools.guard === 'function'
        ? ctx.tools.guard((execution) => {
            const toolName = String(execution.name || '');
            const sessionId = execution.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                return undefined;
            const [scope, target] = String(sessionKey).split(':', 2);
            if (scope !== 'group')
                return undefined;
            const mutatingAndroidTools = new Set([
                'android_interact',
                'android_launch_app',
                'android_boot',
                'android_shutdown',
                'android_build_run',
                'android_tap_element',
                'android_tap_text',
                'android_tap_row',
            ]);
            const shellLooksLikeAdb = (toolName === 'pwsh' || toolName === 'bash')
                && /\badb\b|MuMuManager|com\.hypergryph/i.test(JSON.stringify(execution.arguments || {}));
            if (!mutatingAndroidTools.has(toolName) && !shellLooksLikeAdb)
                return undefined;
            try {
                const fs = process.getBuiltinModule('fs');
                const path = process.getBuiltinModule('path');
                const root = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
                const state = JSON.parse(fs.readFileSync(path.resolve(root, 'data', 'mumud', 'state.json'), 'utf8'));
                const activeGroup = String(state.activeGroupId || state.activeSession?.groupId || '');
                if (state.running === true && activeGroup === String(target))
                    return 'The bigfish-play worker owns MuMu for this group. Do not start a second game controller; use bigfish_gameplay_status and reply from its state.';
                const request = JSON.parse(fs.readFileSync(path.resolve(root, 'data', 'mumud', 'request.json'), 'utf8'));
                const requestedAt = Date.parse(request.requestedAt);
                if (
                    String(request.groupId || '') === String(target)
                    && Number.isFinite(requestedAt)
                    && Date.now() - requestedAt >= 0
                    && Date.now() - requestedAt <= 10 * 60_000
                ) {
                    return 'This group already has a fresh BigFish gameplay request. The mumud worker owns that operation; use bigfish_gameplay_status instead of operating MuMu from chat.';
                }
            }
            catch {
                // No active worker state is available, so normal tool policy applies.
            }
            return undefined;
        })
        : () => { };
    const stopDisposable = ctx.tools.register(defineTool({
        name: 'bigfish_stop_gameplay',
        description: 'Immediately stop the current BigFish game, cancel queued gameplay, close the game process and pause future autonomous gameplay until the owner explicitly starts a new game.',
        parameters: {
            reason: {
                type: 'string',
                description: 'Optional short reason from the owner stop request.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    stopped: { type: 'boolean', required: true },
                    queued: { type: 'boolean', required: true },
                    group_id: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: value.stopped
                    ? `Gameplay stopped for group ${value.group_id}.`
                    : `Gameplay stop requested for group ${value.group_id}; mumud has not acknowledged yet.`,
            }],
        },
        timeoutMs: 10000,
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                throw new Error('当前 QQ 会话无法解析游戏停止目标');
            if (globalThis.__bigfishQqOwnerBySession?.get(sessionId) !== true)
                throw new Error('只有主人本人可以停止游戏');
            const [scope, target] = String(sessionKey).split(':', 2);
            if (scope !== 'group')
                throw new Error('游戏停止只允许从白名单群发起');
            const allowedGroups = String(process.env.BIGFISH_ALLOWED_GROUPS || '')
                .split(',').map((value) => value.trim()).filter(Boolean);
            if (!allowedGroups.includes(String(target)))
                throw new Error('当前群不在自动游戏白名单');
            const [{ mkdir, readFile, rename, unlink, writeFile }, { dirname, resolve }] = await Promise.all([
                import('node:fs/promises'),
                import('node:path'),
            ]);
            const projectRoot = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
            const directory = resolve(projectRoot, 'data', 'mumud');
            const requestPath = resolve(directory, 'request.json');
            const stopPath = resolve(directory, 'stop.request.json');
            await mkdir(directory, { recursive: true });
            await unlink(requestPath).catch((error) => {
                if (error?.code !== 'ENOENT') throw error;
            });
            const request = {
                version: 1,
                requestedAt: new Date().toISOString(),
                scope: 'global',
                groupId: String(target),
                requestedByOwner: true,
                reason: String(args.reason || 'owner requested that gameplay stop').trim().slice(0, 1000),
            };
            const temporary = `${stopPath}.tmp`;
            await writeFile(temporary, `${JSON.stringify(request, null, 2)}\n`, 'utf8');
            await rename(temporary, stopPath);
            let stopped = false;
            for (let attempt = 0; attempt < 12; attempt += 1) {
                await new Promise((resolveDelay) => setTimeout(resolveDelay, 300));
                try {
                    const state = JSON.parse(await readFile(resolve(directory, 'state.json'), 'utf8'));
                    if (state.autonomyPaused === true && state.running !== true) {
                        stopped = true;
                        break;
                    }
                }
                catch {
                    // The acknowledgement may race the first state write.
                }
            }
            return { stopped, queued: !stopped, group_id: String(target) };
        },
    }));
    console.info('[bigfish-game] bigfish_request_gameplay registered');
    console.info('[bigfish-game] bigfish_gameplay_status registered');
    console.info('[bigfish-game] bigfish_stop_gameplay registered');
    return () => {
        for (const disposable of [gameplayToolGuard, requestDisposable, statusDisposable, stopDisposable]) {
            if (typeof disposable === 'function')
                disposable();
            else
                disposable?.dispose?.();
        }
    };
}
