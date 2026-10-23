const BIGFISH_DEEPSEEK_TIP_TOPUP_URL = 'https://platform.deepseek.com/top_up';
const BIGFISH_DEEPSEEK_SIGNIN_URL = 'https://platform.deepseek.com/sign_in';

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

export async function bigFishCaptureDeepSeekTopUp(options = {}) {
    const [{ mkdir, readdir, unlink }, { resolve, basename }] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
    ]);
    const { chromium } = await import('playwright');
    const root = resolve(options.root || process.env.BIGFISH_PROJECT_ROOT || process.cwd());
    const profileDir = resolve(root, 'data', 'browser-profile-web');
    const generatedDir = resolve(root, 'data', 'support', 'generated');
    await mkdir(generatedDir, { recursive: true });
    const screenshotPath = resolve(generatedDir, `deepseek-${Date.now()}.png`);
    const context = await chromium.launchPersistentContext(profileDir, {
        channel: options.channel || 'msedge',
        headless: options.headless !== false,
        viewport: { width: 1280, height: 900 },
    });
    try {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(options.url || BIGFISH_DEEPSEEK_TIP_TOPUP_URL, {
            waitUntil: 'domcontentloaded',
            timeout: options.timeoutMs || 30000,
        });
        await page.waitForTimeout(options.settleMs || 2500);
        const currentUrl = page.url();
        const title = await page.title();
        const text = (await page.locator('body').innerText()).slice(0, 6000);
        const loginRequired = currentUrl.includes('/sign_in') || /微信扫码登录|发送验证码/.test(text);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        const previous = await readdir(generatedDir).catch(() => []);
        for (const name of previous) {
            if (!name.endsWith('.png') || resolve(generatedDir, name) === screenshotPath) continue;
            if (Date.now() - Number(name.match(/deepseek-(\d+)\.png/)?.[1] || 0) > 10 * 60 * 1000) {
                await unlink(resolve(generatedDir, name)).catch(() => undefined);
            }
        }
        return {
            ok: true,
            loginRequired,
            url: currentUrl,
            title,
            screenshotPath,
            screenshotName: basename(screenshotPath),
            text,
        };
    } finally {
        await context.close();
    }
}

export async function bigFishCreateDeepSeekPaymentQr(options = {}) {
    const allowedAmounts = [10, 20, 50, 100, 300, 500];
    const amount = Number(options.amount ?? process.env.BIGFISH_DEEPSEEK_TIP_AMOUNT ?? 10);
    if (!allowedAmounts.includes(amount)) {
        return {
            ok: false,
            loginRequired: false,
            reason: `DeepSeek 支持金额只允许 ${allowedAmounts.join('/')} 元`,
        };
    }
    const [{ mkdir }, { resolve }] = await Promise.all([
        import('node:fs/promises'),
        import('node:path'),
    ]);
    const { chromium } = await import('playwright');
    const root = resolve(options.root || process.env.BIGFISH_PROJECT_ROOT || process.cwd());
    const profileDir = resolve(root, 'data', 'browser-profile-web');
    const generatedDir = resolve(root, 'data', 'support', 'generated');
    await mkdir(generatedDir, { recursive: true });
    const screenshotPath = resolve(generatedDir, `deepseek-pay-${amount}-${Date.now()}.png`);
    const context = await chromium.launchPersistentContext(profileDir, {
        channel: options.channel || 'msedge',
        headless: options.headless !== false,
        viewport: { width: 1280, height: 900 },
    });
    try {
        const page = context.pages()[0] ?? await context.newPage();
        await page.goto(BIGFISH_DEEPSEEK_TIP_TOPUP_URL, {
            waitUntil: 'domcontentloaded',
            timeout: options.timeoutMs || 30000,
        });
        await page.waitForTimeout(options.settleMs || 2200);
        const pageText = (await page.locator('body').innerText()).slice(0, 6000);
        if (page.url().includes('/sign_in') || /微信扫码登录|发送验证码/.test(pageText)) {
            const loginPath = resolve(generatedDir, `deepseek-login-${Date.now()}.png`);
            await page.screenshot({ path: loginPath, fullPage: true });
            return {
                ok: false,
                loginRequired: true,
                reason: 'DeepSeek 登录已过期',
                screenshotPath: loginPath,
            };
        }
        const dismiss = page.getByRole('button', { name: /知道了|关闭/ }).first();
        if (await dismiss.isVisible().catch(() => false)) await dismiss.click();
        const amountOption = page.getByRole('radio', { name: new RegExp(`¥\\s*${amount}(?:\\D|$)`) }).first();
        if (await amountOption.count()) await amountOption.click({ force: true });
        else if (amount !== 10) {
            return { ok: false, loginRequired: false, reason: `页面没有找到 ¥${amount} 金额选项` };
        }
        const payButton = page.getByRole('button', { name: /去支付|下一步/ }).first();
        await payButton.waitFor({ state: 'visible', timeout: 15000 });
        await payButton.click();
        const dialog = page.getByRole('dialog').last();
        await dialog.waitFor({ state: 'visible', timeout: 20000 });
        await page.waitForTimeout(1800);
        const dialogText = await dialog.innerText().catch(() => '');
        const qrCandidates = dialog.locator('svg, canvas, img[src*="qr" i]');
        const qrCount = await qrCandidates.count();
        if (qrCount === 0 && !/扫码|二维码|支付/.test(dialogText)) {
            return {
                ok: false,
                loginRequired: false,
                reason: '支付页没有生成可识别的二维码',
            };
        }
        await dialog.screenshot({ path: screenshotPath });
        return {
            ok: true,
            loginRequired: false,
            amount,
            screenshotPath,
            reason: 'fresh payment QR created',
        };
    } finally {
        await context.close();
    }
}

async function bigFishScreenshotMessage(path) {
    const { readFile } = await import('node:fs/promises');
    const bytes = await readFile(path);
    return {
        type: 'image',
        data: { file: `base64://${bytes.toString('base64')}`, summary: 'image/png' },
    };
}

export function registerBigFishDeepSeekLoginTool(ctx, client, cfg) {
    if (!ctx.tools?.register) return () => {};
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_deepseek_login',
        description: 'Owner-only one-time DeepSeek platform login helper. Opens the official DeepSeek sign-in page, captures its current WeChat login QR, and sends it privately to the owner. Never send this login QR to a group.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sent: { type: 'boolean', required: true },
                    loginRequired: { type: 'boolean', required: true },
                    reason: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: value.sent ? '已私聊发送 DeepSeek 登录码' : `未发送登录码：${value.reason}`,
            }],
        },
        timeoutMs: 45000,
        isConcurrencySafe: () => false,
        async execute(_args, exec) {
            const sessionId = exec.agent?.session?.id;
            if (globalThis.__bigfishQqOwnerBySession?.get(sessionId) !== true) {
                throw new Error('只有主人可以刷新 DeepSeek 登录码');
            }
            const capture = await bigFishCaptureDeepSeekTopUp({ url: BIGFISH_DEEPSEEK_SIGNIN_URL });
            if (!capture.loginRequired) {
                return { sent: false, loginRequired: false, reason: 'DeepSeek 已登录，无需刷新登录码' };
            }
            await client.sendPrivate(Number(cfg.access.adminQq), [
                await bigFishScreenshotMessage(capture.screenshotPath),
                { type: 'text', data: { text: '\nDeepSeek 平台登录码，只用于主人扫码；一次登录后会复用浏览器会话。' } },
            ]);
            return { sent: true, loginRequired: true, reason: '登录码已私聊发送' };
        },
    }));
    console.info('[bigfish-deepseek] bigfish_deepseek_login registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}

export function registerBigFishDeepSeekTipTool(ctx, client) {
    if (!ctx.tools?.register) return () => {};
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_support_deepseek',
        description: 'Create a fresh short-lived DeepSeek Alipay top-up order for a supported preset amount, capture only its payment QR, and send it to the current whitelisted QQ group. Use when someone asks how to support BigFish or add API credit. Never send the DeepSeek account login QR to a group and never invent a payment code.',
        parameters: {
            amount: {
                type: 'number',
                description: 'Optional supported top-up amount in CNY: 10, 20, 50, 100, 300, or 500. Default 10.',
            },
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
                    loginRequired: { type: 'boolean', required: true },
                    amount: { type: 'number', required: true },
                    topUpUrl: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: value.sent ? `已发送 ¥${value.amount} 的 DeepSeek 支付二维码` : `未发送支持码：${value.reason}`,
            }],
        },
        timeoutMs: 45000,
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
            const requestedAmount = Number(args.amount ?? process.env.BIGFISH_DEEPSEEK_TIP_AMOUNT ?? 10);
            const capture = await bigFishCreateDeepSeekPaymentQr({ amount: requestedAmount });
            if (capture.loginRequired) {
                return {
                    sent: false,
                    loginRequired: true,
                    amount: requestedAmount,
                    reason: 'DeepSeek 平台登录已过期，主人需要先刷新并扫码登录',
                    topUpUrl: BIGFISH_DEEPSEEK_TIP_TOPUP_URL,
                };
            }
            if (!capture.ok) {
                return {
                    sent: false,
                    loginRequired: false,
                    amount: requestedAmount,
                    reason: capture.reason,
                    topUpUrl: BIGFISH_DEEPSEEK_TIP_TOPUP_URL,
                };
            }
            const message = [await bigFishScreenshotMessage(capture.screenshotPath)];
            const caption = String(args.caption || '').trim()
                || `现开的 ¥${capture.amount} 支付宝充值码，支持随意，付款会进入 DeepSeek API 余额；二维码过期就重新叫我。`;
            message.push({ type: 'text', data: { text: `\n${caption.slice(0, 200)}` } });
            await client.sendGroup(targetId, message);
            return {
                sent: true,
                loginRequired: false,
                amount: capture.amount,
                reason: 'sent',
                topUpUrl: BIGFISH_DEEPSEEK_TIP_TOPUP_URL,
            };
        },
    }));
    console.info('[bigfish-deepseek] bigfish_support_deepseek registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
