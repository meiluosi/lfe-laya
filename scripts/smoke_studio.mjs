// 观察台冒烟（/studio.html，规则模式，无需模型服务）：
// 播放与暂停、带子回看（鼠标与键盘）、回到现在后世界与回看前逐位一致、命令面板、抽屉、重新播种、窄屏。
import assert from 'node:assert/strict';
import { withPage } from './smoke_lib.mjs';

await withPage(async ({ page, base, problems, browserName }) => {
  await page.goto(base + '/studio.html');
  const badge = page.locator('.badge strong');
  await badge.waitFor({ timeout: 20000 });
  const clock = async () => Number(await page.locator('.clock strong').innerText());
  const slider = page.getByRole('slider', { name: '时间带子' });
  const attr = async name => Number(await slider.getAttribute(name));
  const stateHash = async () => { const open = await page.locator('.drawer').count(); if (!open) await page.getByRole('button', { name: '实验', exact: true }).click(); const t = await page.locator('.drawer .mono', { hasText: '状态' }).innerText(); return t.match(/状态 (\w+)/)[1]; };

  assert.match(await badge.innerText(), /真实模拟/); assert.equal(await clock(), 0);
  await page.getByRole('button', { name: '单轮' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.clock strong').textContent) >= 1, null, { timeout: 15000 });
  // 播放（16×）→ 暂停
  await page.getByRole('button', { name: '16×' }).click();
  await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => Number(document.querySelector('.clock strong').textContent) >= 12, null, { timeout: 40000 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '播放', exact: true }).waitFor();
  const liveAt = await clock(); await page.waitForTimeout(600); assert.equal(await clock(), liveAt, '暂停后时间不应继续推进');
  const total = await attr('aria-valuemax'); assert.ok(total >= 5 && await attr('aria-valuenow') === total, '实时时播放头在末尾');
  const hashLive = await stateHash();
  await page.getByRole('button', { name: '关闭实验抽屉' }).click();

  // 鼠标点击带子中部 → 回看：徽标变化、时间回退、环境工具被禁用
  const box = await slider.boundingBox();
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height / 2);
  await page.locator('.badge strong', { hasText: '回看' }).waitFor({ timeout: 10000 });
  const mid = await clock(); assert.ok(mid < liveAt && mid > 0, `回看时间 ${mid} 应小于 ${liveAt}`);
  assert.ok(await attr('aria-valuenow') < total);
  assert.ok(await page.getByRole('button', { name: '营养', exact: true }).isDisabled(), '回看时不能改变环境');
  // 键盘：← 减一格
  await slider.focus(); const before = await attr('aria-valuenow'); await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(v => Number(document.querySelector('[role=slider]').getAttribute('aria-valuenow')) === v - 1, before, { timeout: 5000 });
  // 回到现在：时间与回看前相同，状态哈希逐位一致，且仍可继续运行
  await page.getByRole('button', { name: '回到现在' }).click();
  await page.locator('.badge strong', { hasText: '真实模拟' }).waitFor({ timeout: 10000 });
  assert.equal(await clock(), liveAt); assert.equal(await stateHash(), hashLive, '回看不应改变实时世界');
  await page.getByRole('button', { name: '关闭实验抽屉' }).click();
  await page.getByRole('button', { name: '单轮' }).click();
  await page.waitForFunction(t => Number(document.querySelector('.clock strong').textContent) > t, liveAt, { timeout: 15000 });

  // 选中个体：通过命令面板选择 → 故事卡出现并有“刚才/它看到的/经历”；跟随与取消
  await page.keyboard.press('Control+K'); await page.getByLabel('搜索命令').fill('选择 life-1'); await page.keyboard.press('Enter');
  const story = page.getByRole('complementary', { name: 'life-1 的故事卡' });
  await story.waitFor({ timeout: 5000 });
  for (const heading of ['刚才', '它看到的', '它的倾向', '经历']) await story.getByRole('heading', { name: heading }).waitFor();
  assert.ok(await story.isVisible()); const cardBox = await story.boundingBox(); assert.ok(cardBox.x >= 0 && cardBox.x + cardBox.width <= 1280, '故事卡应在视口内');
  await story.getByRole('button', { name: '跟随' }).click(); await story.getByRole('button', { name: '停止跟随' }).waitFor();
  await story.getByRole('button', { name: '取消选择' }).click(); await story.waitFor({ state: 'detached' });

  // 分支与对照：创建随机策略分支 → 原世界与分支各自推进相同轮数 → 带子叠加对照曲线、画布出现同一时刻的对照提示
  await page.getByRole('button', { name: '实验', exact: true }).click();
  for (const h of ['学习与完整恢复', '能量与资源变化', '谱系', '运行证据']) await page.getByRole('heading', { name: h }).first().waitFor({ timeout: 5000 });
  await page.getByLabel('分支唯一改变量').selectOption('random'); await page.getByRole('button', { name: '创建对照分支' }).click();
  await page.getByRole('listitem').filter({ hasText: '分支 1' }).waitFor({ timeout: 10000 });
  await page.locator('.compare-chip').waitFor(); assert.match(await page.locator('.compare-chip').innerText(), /原世界/);
  const forkAt = await clock(); assert.equal(forkAt, liveAt + 1, '分支从当前动作边界分叉');
  await page.getByRole('button', { name: '关闭实验抽屉' }).click();
  for (let i = 1; i <= 3; i++) { await page.getByRole('button', { name: '单轮' }).click(); await page.waitForFunction(t => Number(document.querySelector('.clock strong').textContent) >= t, forkAt + i, { timeout: 15000 }); }
  assert.equal(await clock(), forkAt + 3);
  assert.match(await page.locator('.compare-chip').innerText(), /没有记录/, '原世界尚无此时刻的记录');
  await page.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByRole('listitem').filter({ hasText: '原世界' }).getByRole('button', { name: '切换' }).click();
  await page.waitForFunction(t => Number(document.querySelector('.clock strong').textContent) === t, forkAt, { timeout: 10000 });
  await page.getByRole('button', { name: '关闭实验抽屉' }).click();
  for (let i = 1; i <= 3; i++) { await page.getByRole('button', { name: '单轮' }).click(); await page.waitForFunction(t => Number(document.querySelector('.clock strong').textContent) >= t, forkAt + i, { timeout: 15000 }); }
  await page.waitForFunction(() => /同在/.test(document.querySelector('.compare-chip')?.textContent ?? ''), null, { timeout: 5000 });
  assert.ok(await page.locator('.tape-compare').count() === 1, '带子应叠加对照曲线');

  // 命令面板：Ctrl+K 打开、过滤、回车执行
  await page.keyboard.press('Control+K'); await page.getByRole('dialog', { name: '命令面板' }).waitFor();
  await page.getByLabel('搜索命令').fill('轨迹'); await page.keyboard.press('Enter');
  await page.getByRole('dialog', { name: '命令面板' }).waitFor({ state: 'detached' });
  // 抽屉：重新播种回到 0 秒，带子清空
  await page.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByLabel('世界种子').fill('5'); await page.getByRole('button', { name: '重新播种' }).click();
  await page.waitForFunction(() => Number(document.querySelector('.clock strong').textContent) === 0, null, { timeout: 10000 });
  assert.equal(await attr('aria-valuemax'), 0);
  await page.getByRole('button', { name: '关闭实验抽屉' }).click();

  // 语义食物世界：播种后出现观察者图例（描述 + 真实影响），观测里带有描述；个体看到的描述出现在故事卡文字里
  await page.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByLabel('播种场景').selectOption('semantic'); await page.getByRole('button', { name: '重新播种' }).click();
  const legend = page.getByRole('complementary', { name: '食物种类图例（观察者）' }); await legend.waitFor({ timeout: 10000 });
  assert.ok(await legend.locator('li').count() >= 6, '图例至少列出 6 种食物'); assert.match(await legend.innerText(), /真实影响/);
  assert.ok((await legend.locator('b.neg').count()) >= 1 && (await legend.locator('b.pos').count()) >= 1, '应同时有有益与有毒的种类');
  await page.getByRole('button', { name: '关闭实验抽屉' }).click();
  await page.getByRole('button', { name: '单轮' }).click(); await page.waitForFunction(() => Number(document.querySelector('.clock strong').textContent) >= 1, null, { timeout: 15000 });
  await page.getByRole('button', { name: '实验', exact: true }).click(); await page.getByLabel('播种场景').selectOption('ecology'); await page.getByRole('button', { name: '重新播种' }).click();
  await legend.waitFor({ state: 'detached' }); await page.getByRole('button', { name: '关闭实验抽屉' }).click();

  // 适应与保留：A/B/A 反转场景 + 环境分段记忆基因组 → 面板出现，窗口柱随运行增加；普通生态场景下面板不出现
  await page.getByRole('button', { name: '实验', exact: true }).click();
  await page.getByLabel('播种场景').selectOption('aba-off'); await page.getByRole('button', { name: '重新播种' }).click();
  await page.getByLabel('大脑模式').selectOption('evolved:ctx-regime');
  const adapt = page.getByTestId('adapt-panel'); await adapt.waitFor({ timeout: 10000 });
  assert.match(await adapt.innerText(), /适应与保留/); assert.equal(await adapt.locator('.band').count(), 3, 'A/B/A 应有三个阶段');
  await page.getByLabel('播种场景').selectOption('abab-off'); await page.getByRole('button', { name: '重新播种' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.adapt .band').length === 5, null, { timeout: 10000 });
  await page.getByLabel('播种场景').selectOption('aba-off'); await page.getByRole('button', { name: '重新播种' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.adapt .band').length === 3, null, { timeout: 10000 });
  await page.getByRole('button', { name: '关闭实验抽屉' }).click();
  await page.getByRole('button', { name: '16×' }).click(); await page.getByRole('button', { name: '播放', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.adapt .win').length >= 3, null, { timeout: 60000 });
  await page.getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '实验', exact: true }).click(); await page.getByLabel('播种场景').selectOption('ecology'); await page.getByRole('button', { name: '重新播种' }).click();
  await adapt.waitFor({ state: 'detached' }); await page.getByRole('button', { name: '关闭实验抽屉' }).click();

  // 窄屏：无横向溢出，播放控件可见
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, '窄屏横向溢出');
  assert.ok(await page.getByRole('button', { name: '播放', exact: true }).isVisible());
  assert.deepEqual(problems, [], '页面出现错误');
  console.log(`studio smoke ok: browser=${browserName} liveAt=${liveAt}s tape=${total} entries`);
});
