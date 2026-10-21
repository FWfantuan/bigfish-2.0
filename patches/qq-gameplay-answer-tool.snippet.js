// BIGFISH_QQ_GAMEPLAY_ANSWER_TOOL
function registerBigFishGameplayAnswerTool(ctx, cfg, officialMode) {
    if (officialMode || !ctx.tools?.register)
        return () => { };
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_answer_gameplay',
        description: 'Answer the active strategic question from BigFish gameplay. Use only when the owner is responding to the pending opening, operator, relic, route, event or deployment choice. The background game is paused while it waits.',
        parameters: {
            answer: {
                type: 'string',
                required: true,
                description: 'The owner decision, preserving concrete names or option labels',
            },
            questionId: {
                type: 'string',
                description: 'Optional active question ID when the context shows it',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    accepted: { type: 'boolean', required: true },
                    questionId: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: value.accepted
                    ? `Gameplay answer accepted for ${value.questionId}`
                    : `Gameplay answer rejected for ${value.questionId}`,
            }],
        },
        timeoutMs: 15000,
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                throw new Error('当前 QQ 会话无法解析游戏回答目标');
            if (globalThis.__bigfishQqOwnerBySession?.get(sessionId) !== true)
                throw new Error('游戏选择只允许主人回答');
            const [scope, target] = String(sessionKey).split(':', 2);
            const targetId = Number(target);
            const allowedGroups = String(process.env.BIGFISH_ALLOWED_GROUPS || '')
                .split(',').map((value) => value.trim()).filter(Boolean);
            if (scope === 'group' && !allowedGroups.includes(String(targetId)))
                throw new Error('当前群不在游戏白名单');
            if (scope === 'private' && targetId !== Number(cfg.access.adminQq))
                throw new Error('私聊游戏回答只允许主人');

            const [{ readFile, rename, writeFile }, { resolve }] = await Promise.all([
                import('node:fs/promises'),
                import('node:path'),
            ]);
            const projectRoot = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
            const directory = resolve(projectRoot, 'data', 'mumud');
            const activePath = resolve(directory, 'question.active.json');
            let question;
            try {
                question = JSON.parse(await readFile(activePath, 'utf8'));
            } catch {
                throw new Error('当前没有等待回答的剧情、遗物、路线或干员选择');
            }
            const questionId = String(question.id || '');
            if (!questionId)
                throw new Error('等待中的问题缺少编号');
            if (args.questionId?.trim() && args.questionId.trim() !== questionId)
                throw new Error('回答对应的问题已经过期');
            const answer = String(args.answer || '').trim();
            if (!answer)
                throw new Error('回答不能为空');
            const answerPath = resolve(directory, 'question.answer.json');
            const temporary = `${answerPath}.${questionId}.tmp`;
            await writeFile(temporary, JSON.stringify({
                version: 1,
                questionId,
                answeredAt: new Date().toISOString(),
                answer: answer.slice(0, 1000),
            }, null, 2), 'utf8');
            await rename(temporary, answerPath);
            return { accepted: true, questionId };
        },
    }));
    console.info('[bigfish-gameplay-answer] bigfish_answer_gameplay registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
