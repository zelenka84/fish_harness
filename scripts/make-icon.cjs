// Renders the fish logo SVG to desktop/icon.png (512x512) using Electron.
const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="512" height="512">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f5f5f5"/><stop offset="1" stop-color="#a3a3a3"/></linearGradient></defs>
<rect x="2" y="2" width="60" height="60" rx="14" fill="#141414"/>
<rect x="2.5" y="2.5" width="59" height="59" rx="13.5" fill="none" stroke="#ffffff" stroke-opacity=".08"/>
<path d="M16 32 C23 18 43 15 55 32 C43 49 23 46 16 32 Z" fill="url(#g)"/>
<path d="M18 32 L6 21 Q10.5 32 6 43 Z" fill="url(#g)"/>
<circle cx="45" cy="29.5" r="2.7" fill="#141414"/>
<path d="M36 22.5 Q31 32 36 41.5" stroke="#141414" stroke-opacity=".35" stroke-width="2.2" fill="none" stroke-linecap="round"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadURL(`data:text/html,${encodeURIComponent(`<body style="margin:0;background:transparent">${svg}</body>`)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, "..", "desktop", "icon.png");
  fs.writeFileSync(out, img.resize({ width: 512, height: 512 }).toPNG());
  console.log("wrote", out);
  app.quit();
});
