const BIGFISH_DEEPSEEK_TIP_TOPUP_URL = 'https://platform.deepseek.com/top_up';

export async function bigFishResolveDeepSeekTipQr(options = {}) {
    const [{ access }, { resolve }] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
    ]);
    const root = resolve(options.root || process.env.BIGFISH_PROJECT_ROOT || process.cwd());
    const supportDir = resolve(root, 'data', 'support');
    const configured = String(options.configuredPath || process.env.BIGFISH_DEEPSEEK_TIP_QR || '').trim();
    const candidates = configured
        ? [resolve(root, configured), resolve(configured)]
        : [
            resolve(supportDir, 'deepseek-tip-qr.png'),
            resolve(supportDir, 'deepseek-tip-qr.jpg'),
            resolve(supportDir, 'deepseek-tip-qr.jpeg'),
            resolve(supportDir, 'deepseek-tip-qr.webp'),
        ];
    for (const path of candidates) {
        const relative = path.startsWith(`${supportDir}\\`) || path.startsWith(`${supportDir}/`);
        if (!relative) continue;
        try {
            await access(path);
            return path;
        } catch {
            // Try the next supported image.
        }
    }
    return null;
}

export function registerBigFishDeepSeekTipTool(ctx, client) {
    if (!ctx.tools?.register) return () => {};
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_support_deepseek',
        description: 'Send the owner-configured DeepSeek API balance support QR image to the current whitelisted QQ group. Use when someone asks how to support BigFish or donate toward API credit. Never invent a payment code; if no QR is configured, report that clearly.',
        parameters: {
            caption: {
                type: 'string',
                description: 'Optional short BigFish-style caption. Make clear that support is voluntary and goes toward API usage.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sent: { type: 'boolean', required: true },
                    reason: { type: 'string', required: true },
                    topUpUrl: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: value.sent ? '已发送 DeepSeek API 支持码' : `未发送支持码：${value.reason}`,
            }],
        },
        timeoutMs: 30000,
        isConcurrencySafe: () => false,
        async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey) throw new Error('当前 QQ 会话无法解析支持码发送目标');
            const [scope, target] = String(sessionKey).split(':', 2);
            const targetId = Number(target);
            if (scope !== 'group' || !Number.isFinite(targetId)) {
                throw new Error('DeepSeek 支持码只允许发送到白名单群');
            }
            const allowedGroups = String(process.env.BIGFISH_ALLOWED_GROUPS || '')
                .split(',').map((value) => value.trim()).filter(Boolean);
            if (!allowedGroups.includes(String(targetId))) {
                throw new Error('当前群不在支持码发送白名单');
            }
            const qrPath = await bigFishResolveDeepSeekTipQr();
            if (!qrPath) {
                return {
                    sent: false,
                    reason: '主人还没有配置 DeepSeek 支持码图片',
                    topUpUrl: BIGFISH_DEEPSEEK_TIP_TOPUP_URL,
                };
            }
            const [{ readFile }, { extname }] = await Promise.all([
                import('node:fs/promises'),
                import('node:path'),
            ]);
            const bytes = await readFile(qrPath);
            const extension = extname(qrPath).toLowerCase();
            const mime = extension === '.png' ? 'image/png'
                : extension === '.webp' ? 'image/webp'
                    : 'image/jpeg';
            const message = [{
                type: 'image',
                data: { file: `base64://${bytes.toString('base64')}`, summary: mime },
            }];
            const caption = String(args.caption || '').trim();
            if (caption) message.push({ type: 'text', data: { text: `\n${caption.slice(0, 160)}` } });
            await client.sendGroup(targetId, message);
            return {
                sent: true,
                reason: 'sent',
                topUpUrl: BIGFISH_DEEPSEEK_TIP_TOPUP_URL,
            };
        },
    }));
    console.info('[bigfish-deepseek] bigfish_support_deepseek registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
