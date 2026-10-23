const BIGFISH_DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const BIGFISH_DEEPSEEK_TOPUP_URL = 'https://platform.deepseek.com/top_up';

function bigFishUsageNumber(value) {
    const number = Number(value ?? 0);
    return Number.isFinite(number) && number >= 0 ? number : 0;
}

export function bigFishNormalizeTokenUsage(totals = {}, pressure = {}) {
    const uncachedInputTokens = bigFishUsageNumber(totals.uncachedInputTokens);
    const outputTokens = bigFishUsageNumber(totals.outputTokens);
    const cacheReadTokens = bigFishUsageNumber(totals.cacheReadTokens);
    const cacheWriteTokens = bigFishUsageNumber(totals.cacheWriteTokens);
    return {
        uncachedInputTokens,
        outputTokens,
        cacheReadTokens,
        cacheWriteTokens,
        totalTokens: uncachedInputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
        contextPressureTokens: bigFishUsageNumber(pressure.pressureTokens),
        projectedTokens: bigFishUsageNumber(pressure.projectedTokens),
        contextWindowTokens: bigFishUsageNumber(pressure.contextWindow),
    };
}

export async function bigFishReadDeepSeekBalance(options = {}) {
    const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY ?? '';
    if (!apiKey) {
        return {
            ok: false,
            error: 'DEEPSEEK_API_KEY 未配置',
            currency: '',
            totalBalance: null,
            grantedBalance: null,
            toppedUpBalance: null,
        };
    }
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') throw new Error('当前运行时没有 fetch');
    const response = await fetchImpl(options.url ?? BIGFISH_DEEPSEEK_BALANCE_URL, {
        method: 'GET',
        headers: { authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
    if (!response.ok) throw new Error(`DeepSeek 余额接口返回 HTTP ${response.status}`);
    const data = await response.json();
    const info = Array.isArray(data?.balance_infos) ? data.balance_infos.find((item) => item?.currency === 'CNY') ?? data.balance_infos[0] : null;
    return {
        ok: true,
        available: data?.is_available === true,
        currency: String(info?.currency || ''),
        totalBalance: info?.total_balance == null ? null : String(info.total_balance),
        grantedBalance: info?.granted_balance == null ? null : String(info.granted_balance),
        toppedUpBalance: info?.topped_up_balance == null ? null : String(info.topped_up_balance),
        checkedAt: new Date().toISOString(),
    };
}

export async function bigFishAggregateProjectionUsage(directory) {
    const [{ readFile }, { readdir }] = await Promise.all([
        import('node:fs/promises'),
        import('node:fs/promises'),
    ]);
    let entries;
    try {
        entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
        if (error?.code === 'ENOENT') entries = [];
        else throw error;
    }
    const totals = {
        uncachedInputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
    };
    let sessionCount = 0;
    let sessionsWithUsage = 0;
    for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
        try {
            const value = JSON.parse(await readFile(`${directory}/${entry.name}`, 'utf8'));
            const state = value?.record?.rows?.tokenUsage?.val ?? value?.rows?.tokenUsage?.val;
            const current = state?.totals;
            if (!current || typeof current !== 'object') continue;
            sessionCount += 1;
            const normalized = bigFishNormalizeTokenUsage(current);
            if (normalized.totalTokens > 0) sessionsWithUsage += 1;
            totals.uncachedInputTokens += normalized.uncachedInputTokens;
            totals.outputTokens += normalized.outputTokens;
            totals.cacheReadTokens += normalized.cacheReadTokens;
            totals.cacheWriteTokens += normalized.cacheWriteTokens;
        } catch {
            // A projection can be replaced while it is being read. Skip that file.
        }
    }
    return {
        ...bigFishNormalizeTokenUsage(totals),
        sessionCount,
        sessionsWithUsage,
    };
}

export function registerBigFishDeepSeekUsageTool(ctx) {
    if (!ctx.tools?.register) return () => {};
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_deepseek_usage',
        description: 'Read the owner-only DeepSeek API wallet balance and aggregate provider-reported token usage from all local DSH sessions. Use whenever the owner asks about balance, remaining credit, token burn, or API cost. Never guess these values.',
        parameters: {},
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    balance: { type: 'object', required: true },
                    allSessions: { type: 'object', required: true },
                    currentSession: { type: 'object', required: true },
                    topUpUrl: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: `DeepSeek balance ${value.balance.totalBalance ?? 'unknown'} ${value.balance.currency || ''}; tokens ${value.allSessions.totalTokens}`,
            }],
        },
        timeoutMs: 20000,
        isConcurrencySafe: () => true,
        async execute(_args, exec) {
            const sessionId = exec.agent?.session?.id;
            if (globalThis.__bigfishQqOwnerBySession?.get(sessionId) !== true) {
                throw new Error('DeepSeek 余额和 token 使用量只允许主人查询');
            }
            const balance = await bigFishReadDeepSeekBalance().catch((error) => ({
                ok: false,
                error: error instanceof Error ? error.message : String(error),
                currency: '',
                totalBalance: null,
                grantedBalance: null,
                toppedUpBalance: null,
            }));
            const dshHome = process.env.DSH_HOME || resolve(process.env.USERPROFILE || '', '.dsh');
            const projections = await bigFishAggregateProjectionUsage(resolve(dshHome, 'storages', 'session_projcache', 'sessions'));
            let currentSession = bigFishNormalizeTokenUsage();
            try {
                const session = exec.agent?.session;
                const usage = session && ctx.sessionProjections?.stateOf(session, 'tokenUsage');
                const pressure = session && ctx.sessionProjections?.stateOf(session, 'contextPressure');
                currentSession = bigFishNormalizeTokenUsage(usage?.totals ?? usage ?? {}, pressure ?? {});
            } catch {
                // Keep the explicit zero shape if the projection is momentarily unavailable.
            }
            return { balance, allSessions: projections, currentSession, topUpUrl: BIGFISH_DEEPSEEK_TOPUP_URL };
        },
    }));
    console.info('[bigfish-deepseek] bigfish_deepseek_usage registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
