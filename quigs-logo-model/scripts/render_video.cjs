// Renders video/template.html frame by frame with Playwright and pipes JPEG frames to ffmpeg.
//   node render_video.cjs scene.json out.mp4 [--still 12.5 ...] [--stills-only]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

(async () => {
  const args = process.argv.slice(2);
  const [scenePath, out] = args;
  const stills = []; let stillsOnly = false;
  for (let i = 2; i < args.length; i++) {
    if (args[i] === '--still') stills.push(parseFloat(args[++i]));
    if (args[i] === '--stills-only') stillsOnly = true;
  }
  const sc = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'video', 'template.html'), 'utf8');
  const htmlPath = scenePath.replace(/\.json$/, '.html');
  fs.writeFileSync(htmlPath, tpl.replace('/*SCENE*/null', JSON.stringify(sc)));

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: sc.W, height: sc.H }, deviceScaleFactor: 1 });
  await page.goto('file://' + htmlPath);
  await page.evaluate(() => window.ready);

  for (const t of stills) {
    await page.evaluate(t => window.setTime(t), t);
    await page.screenshot({ path: out.replace(/\.mp4$/, '') + `_t${t.toFixed(1)}.png` });
  }
  if (!stillsOnly) {
    const ff = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(sc.fps), '-c:v', 'mjpeg', '-i', '-',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '17', '-preset', 'medium',
      '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    const n = Math.round(sc.duration * sc.fps);
    for (let i = 0; i < n; i++) {
      await page.evaluate(t => window.setTime(t), i / sc.fps);
      const buf = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(buf)) await new Promise(r => ff.stdin.once('drain', r));
    }
    ff.stdin.end();
    await new Promise(r => ff.on('close', r));
  }
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
