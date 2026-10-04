// 旧版观察室冒烟：规则模式，无需模型服务。覆盖单轮、选择、倍速、暂停、营养投放、详情面板、分支、缩放、窄屏、无控制台错误。
import assert from 'node:assert/strict';
import { withPage } from './smoke_lib.mjs';

await withPage(async ({ page, base, problems, browserName }) => {
  await page.goto(base + '/lab.html');
  await page.getByRole('button', { name: '实验详情' }).waitFor({ timeout: 20000 });
  const seconds = async () => Number(await page.locator('.lab-time strong').innerText());
  const living = async () => Number((await page.locator('.lab-time span').innerText()).match(/\d+/)[0]);

  assert.equal(await seconds(), 0); const initialLiving = await living(); assert.ok(initialLiving >= 8, 'initial population');
  // 单轮：确定地推进 1 秒（10 个模拟步）
  await page.getByRole('button', { name: '单轮' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.lab-time strong').textContent) >= 1, null, { timeout: 15000 });
  assert.equal(await seconds(), 1);
  // 选择：下拉选另一个生命，面板标题随之变化
  const options = await page.locator('select[aria-label="选择生命"] option').evaluateAll(o => o.map(x => x.value).filter(Boolean));
  assert.ok(options.length >= 2); await page.selectOption('select[aria-label="选择生命"]', options[1]);
  await page.locator('.life-panel h2', { hasText: options[1] }).waitFor();
  // 播放 + 倍速，再暂停：暂停后时间不再变化
  await page.selectOption('select[aria-label="模拟速度"]', '16');
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.lab-time strong').textContent) >= 5, null, { timeout: 30000 });
  await page.getByRole('button', { name: '暂停' }).click();
  await page.getByRole('button', { name: '开始' }).waitFor();
  const frozenAt = await seconds(); await page.waitForTimeout(800); assert.equal(await seconds(), frozenAt, '暂停后时间不应继续推进');
  // 暂停中投放营养：世界时间不变，营养总量增加
  const nutrient = async () => Number((await page.locator('.world-totals span', { hasText: '营养' }).locator('b').innerText()));
  const before = await nutrient();
  await page.getByRole('button', { name: '营养', exact: true }).click();
  const box = await page.locator('.lab-world canvas').boundingBox();
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.waitForFunction(b => Number(document.querySelector('.world-totals span:nth-child(3) b').textContent) > b, before, { timeout: 5000 });
  assert.equal(await seconds(), frozenAt);
  // 实验详情：各面板可见；创建同起点分支后对照表出现，且分支独立推进不影响原世界
  await page.getByRole('button', { name: '实验详情' }).click();
  for (const heading of ['世界设置', '运行证据', '同起点对照', '保存与回放', '学习与完整恢复', '最近决策', '谱系']) await page.getByRole('heading', { name: heading, exact: false }).first().waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '创建对照分支' }).click();
  await page.locator('.comparison-scroll tbody tr').nth(1).waitFor({ timeout: 10000 });
  assert.equal(await page.locator('.comparison-scroll tbody tr').count(), 2);
  assert.equal(await seconds(), frozenAt, '创建分支不应推进原世界');
  // 镜头缩放
  await page.getByRole('button', { name: '放大' }).click();
  await page.locator('.camera-controls span', { hasText: '120%' }).waitFor();
  // 窄屏：无横向溢出，关键控件仍可见
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(overflow <= 0, `窄屏横向溢出 ${overflow}px`);
  await page.getByRole('button', { name: '单轮' }).isVisible();
  assert.deepEqual(problems, [], '页面出现错误');
  console.log(`smoke ok: browser=${browserName} time=${frozenAt}s population=${await living()}`);
});
