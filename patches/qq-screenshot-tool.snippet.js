// BIGFISH_QQ_SHARE_SCREENSHOT_TOOL
function registerBigFishScreenshotTool(ctx, client, cfg, officialMode) {
    if (officialMode || !ctx.tools?.register)
        return () => { };
    const disposable = ctx.tools.register(defineTool({
        name: 'bigfish_share_screenshot',
        description: 'Capture the current MuMu or Android screen and send it to the current owner QQ chat immediately. This is an owner-authorized action: never ask for a second confirmation when a visual result, game moment, progress milestone, or troubleshooting state is worth showing.',
        parameters: {
            caption: {
                type: 'string',
                description: 'Optional short BigFish-style caption. Do not write a technical report.',
            },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    sent: { type: 'boolean', required: true },
                    device: { type: 'string', required: true },
                    path: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{
                type: 'text',
                text: `Shared screenshot from ${value.device}: ${value.path}`,
            }],
        },
        isConcurrencySafe: () => false,
        timeoutMs: 30000,
        async execute(args, exec) {
            const sessionId = exec.agent?.session?.id;
            const sessionKey = sessionId === undefined ? undefined : bigfishSessionTargets.get(sessionId);
            if (!sessionKey)
                throw new Error('当前 QQ 会话无法解析截图目标');
            if (globalThis.__bigfishQqOwnerBySession?.get(sessionId) !== true)
                throw new Error('截图分享只允许主人使用');
            const [scope, target] = String(sessionKey).split(':', 2);
            const targetId = Number(target);
            if (!Number.isFinite(targetId))
                throw new Error('当前 QQ 会话目标无效');
            const allowedGroups = String(process.env.BIGFISH_ALLOWED_GROUPS || '')
                .split(',').map((value) => value.trim()).filter(Boolean);
            if (scope === 'group' && !allowedGroups.includes(String(targetId)))
                throw new Error('当前群不在截图白名单');
            if (scope === 'private' && targetId !== Number(cfg.access.adminQq))
                throw new Error('私聊截图只允许发送给主人');

            const [{ execFile }, { promisify }, { mkdir, readFile, writeFile }, { resolve }] = await Promise.all([
                import('node:child_process'),
                import('node:util'),
                import('node:fs/promises'),
                import('node:path'),
            ]);
            const execFileAsync = promisify(execFile);
            const adb = process.env.ADB || 'adb';
            const devices = await execFileAsync(adb, ['devices'], {
                windowsHide: true,
                timeout: 10000,
                maxBuffer: 1024 * 1024,
            });
            const onlineDevices = String(devices.stdout || '')
                .split(/\r?\n/)
                .slice(1)
                .map((line) => line.trim().split(/\s+/))
                .filter((parts) => parts[1] === 'device')
                .map((parts) => parts[0]);
            const projectRoot = process.env.BIGFISH_PROJECT_ROOT || process.cwd();
            let preferredDevice = '';
            try {
                const status = JSON.parse(await readFile(resolve(projectRoot, 'data', 'mumud', 'status.json'), 'utf8'));
                preferredDevice = String(status.device || '');
            } catch {
                // A stopped gameplay worker is fine; use any online device.
            }
            const device = onlineDevices.includes(preferredDevice)
                ? preferredDevice
                : onlineDevices[0];
            if (!device)
                throw new Error('当前没有在线的 Android 设备');
            const capture = await execFileAsync(adb, ['-s', device, 'exec-out', 'screencap', '-p'], {
                windowsHide: true,
                timeout: 30000,
                maxBuffer: 24 * 1024 * 1024,
                encoding: null,
            });
            const bytes = Buffer.isBuffer(capture.stdout) ? capture.stdout : Buffer.from(capture.stdout);
            if (bytes.length === 0)
                throw new Error('设备返回空截图');
            const directory = resolve(projectRoot, 'data', 'media', 'screenshots');
            await mkdir(directory, { recursive: true });
            const path = resolve(directory, `${new Date().toISOString().replace(/[:.]/g, '-')}.png`);
            await writeFile(path, bytes);
            const message = [
                { type: 'image', data: { file: `base64://${bytes.toString('base64')}` } },
            ];
            if (args.caption?.trim())
                message.push({ type: 'text', data: { text: `\n${String(args.caption).trim().slice(0, 500)}` } });
            if (scope === 'private')
                await client.sendPrivate(targetId, message);
            else
                await client.sendGroup(targetId, message);
            return { sent: true, device, path };
        },
    }));
    console.info('[bigfish-screenshot] bigfish_share_screenshot registered');
    return typeof disposable === 'function' ? disposable : () => disposable?.dispose?.();
}
