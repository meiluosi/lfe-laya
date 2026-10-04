// 冒烟测试公共部分：自启 Vite、启动本机 Chromium 内核浏览器、统一收集页面错误。
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

export async function withPage(run, { viewport = { width: 1280, height: 800 } } = {}) {
  const PORT = Number(process.env.SMOKE_PORT ?? 5199);
  const candidates = [process.env.BROWSER_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium'].filter(Boolean);
  const executablePath = candidates.find(existsSync);
  if (!executablePath) { console.error('未找到 Chromium 内核浏览器；设置 BROWSER_PATH'); process.exit(2); }
  const server = spawn('npx', ['vite', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { stdio: 'ignore' });
  const stop = () => server.kill('SIGTERM'); process.on('exit', stop);
  const base = `http://127.0.0.1:${PORT}`;
  for (let i = 0; ; i++) {
    try { if ((await fetch(base + '/lab.html')).ok) break; } catch {}
    if (i > 60) { console.error('开发服务器未启动'); process.exit(2); }
    await new Promise(r => setTimeout(r, 500));
  }
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const problems = [];
  try {
    const page = await browser.newPage({ viewport });
    page.on('console', m => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
    page.on('response', r => { if (r.status() >= 400) problems.push(`http ${r.status()}: ${r.url()}`); });
    page.on('pageerror', e => problems.push(`pageerror: ${e.message}`));
    await run({ page, base, problems, browserName: executablePath.split('/').pop() });
  } catch (error) { console.error('smoke FAILED:', error.message, problems.length ? `\n${problems.join('\n')}` : ''); process.exitCode = 1; }
  finally { await browser.close(); stop(); }
}
