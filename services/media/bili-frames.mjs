import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36";
const REFERER = "https://www.bilibili.com/";
const FRAME_ROOT = resolve(process.env.BIGFISH_FRAME_ROOT || "data/media/frames");
const MAX_VIDEO_BYTES = Number(process.env.BIGFISH_FRAME_MAX_VIDEO_BYTES || 150 * 1024 * 1024);
const RETENTION_MS = Number(process.env.BIGFISH_FRAME_RETENTION_MS || 7 * 24 * 3600 * 1000);

export async function extractBilibiliFrames({
  bvid,
  count = 1,
  page = 1,
  timestampSeconds = null,
}) {
  if (!/^BV[0-9A-Za-z]+$/.test(String(bvid || ""))) throw new Error("invalid bvid");
  const frameCount = Math.max(1, Math.min(8, Math.trunc(Number(count) || 1)));
  const headers = { "user-agent": USER_AGENT, referer: REFERER };

  const detail = await getJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`, headers);
  if (detail.code !== 0 || !detail.data?.cid) throw new Error(`bilibili view failed: ${detail.message || detail.code}`);
  const selectedPage = resolveBilibiliPage(detail.data, page);
  const cid = selectedPage.cid;
  const play = await getJson(
    `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${cid}&qn=64&fnval=1&fnver=0&fourk=0`,
    headers,
  );
  const videoUrl = play.data?.durl?.[0]?.url;
  if (play.code !== 0 || !videoUrl) throw new Error(`bilibili playurl failed: ${play.message || play.code}`);

  await mkdir(FRAME_ROOT, { recursive: true });
  await cleanupOldFrames();
  const outputDir = resolve(FRAME_ROOT, `${bvid}-${Date.now()}`);
  await mkdir(outputDir, { recursive: true });
  const videoPath = resolve(outputDir, "video.mp4");
  try {
    await downloadVideo(videoUrl, videoPath, headers);
    const duration = selectedPage.duration;
    const timestamps = planFrameTimestamps({ duration, count: frameCount, timestampSeconds });
    for (let index = 0; index < timestamps.length; index += 1) {
      const output = resolve(outputDir, `frame-${String(index + 1).padStart(2, "0")}.jpg`);
      await run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y",
        "-ss", timestamps[index].toFixed(3),
        "-i", videoPath,
        "-an", "-sn",
        "-vf", "scale=960:-2:flags=lanczos,format=yuvj420p",
        "-q:v", "3",
        "-frames:v", "1",
        "-strict", "unofficial",
        output,
      ], 120000);
    }
    const files = (await readdir(outputDir))
      .filter((name) => /^frame-\d+\.jpg$/.test(name))
      .sort()
      .map((name) => resolve(outputDir, name));
    if (!files.length) throw new Error("ffmpeg returned no frames");
    return {
      bvid,
      title: selectedPage.title,
      duration,
      page: selectedPage.page,
      timestamps,
      frames: files,
      outputDir,
      coverUrl: detail.data.pic,
    };
  } finally {
    await rm(videoPath, { force: true }).catch(() => {});
  }
}

export function resolveBilibiliPage(data, requestedPage = 1) {
  const pages = Array.isArray(data?.pages) && data.pages.length > 0
    ? data.pages
    : [{
        cid: data?.cid,
        page: 1,
        part: data?.title || "",
        duration: Number(data?.duration) || 1,
      }];
  const pageNumber = Math.max(1, Math.min(pages.length, Math.trunc(Number(requestedPage) || 1)));
  const page = pages[pageNumber - 1];
  if (!page?.cid) throw new Error(`bilibili page ${pageNumber} has no cid`);
  const duration = Number(page.duration) || Number(data?.duration) || 1;
  const baseTitle = String(data?.title || "Bilibili video");
  const partTitle = String(page.part || "").trim();
  return {
    cid: page.cid,
    page: pageNumber,
    duration,
    part: partTitle,
    title: pages.length > 1
      ? `${baseTitle} · P${pageNumber}${partTitle ? ` ${partTitle}` : ""}`
      : baseTitle,
  };
}

export function planFrameTimestamps({
  duration,
  count = 1,
  timestampSeconds = null,
}) {
  const total = Number(duration);
  if (!Number.isFinite(total) || total <= 0) throw new Error("invalid video duration");
  const frameCount = Math.max(1, Math.min(8, Math.trunc(Number(count) || 1)));
  const latest = Math.max(0, total - 1);
  const hasTimestamp = timestampSeconds !== null
    && timestampSeconds !== undefined
    && String(timestampSeconds).trim() !== "";
  const exact = Number(timestampSeconds);
  if (hasTimestamp && Number.isFinite(exact)) {
    const start = Math.max(0, Math.min(latest, exact));
    if (frameCount === 1) return [Number(start.toFixed(3))];
    const spacing = Math.min(1, total / frameCount / 2);
    return Array.from({ length: frameCount }, (_, index) => Number(
      Math.max(0, Math.min(latest, start + (index - (frameCount - 1) / 2) * spacing)).toFixed(3),
    ));
  }
  if (frameCount === 1) return [Number((total * 0.4).toFixed(3))];
  return Array.from({ length: frameCount }, (_, index) => Number(
    Math.min(latest, total * ((index + 1) / (frameCount + 1))).toFixed(3),
  ));
}

async function getJson(url, headers) {
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`request failed: HTTP ${response.status}`);
  return response.json();
}

async function downloadVideo(url, path, headers) {
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error(`video download failed: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_VIDEO_BYTES) throw new Error(`video too large: ${Math.round(length / 1024 / 1024)} MB`);
  let received = 0;
  const source = Readable.fromWeb(response.body);
  source.on("data", (chunk) => {
    received += chunk.length;
    if (received > MAX_VIDEO_BYTES) source.destroy(new Error("video exceeds download limit"));
  });
  await pipeline(source, createWriteStream(path));
}

function run(command, args, timeoutMs = 120000) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => (stderr += chunk));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolveRun();
      else reject(new Error(`${command} failed (${code}): ${stderr.slice(-1000)}`));
    });
  });
}

async function cleanupOldFrames() {
  const cutoff = Date.now() - RETENTION_MS;
  for (const entry of await readdir(FRAME_ROOT, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory()) continue;
    const path = resolve(FRAME_ROOT, entry.name);
    try {
      const info = await stat(path);
      if (info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true });
    } catch {
      // Ignore concurrent cleanup.
    }
  }
}

if (import.meta.url === `file:///${process.argv[1].replace(/\\/g, "/")}`) {
  const bvid = process.argv[2];
  const count = Number(process.argv[3] || 1);
  const page = Number(process.argv[4] || 1);
  const timestampSeconds = process.argv[5] === undefined ? null : Number(process.argv[5]);
  const result = await extractBilibiliFrames({ bvid, count, page, timestampSeconds });
  console.log(JSON.stringify(result));
}
