// Fish Harness desktop shell: runs the local server in-process and shows the UI.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, session } = require("electron");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");

// An installed app starts in its install folder; default the workspace to home instead.
if (app.isPackaged) process.chdir(os.homedir());

let server;
let win;

// Apps started from the Start menu don't inherit HTTPS_PROXY; reuse the
// Windows/macOS system proxy (e.g. a local VPN client) when there is one.
async function adoptSystemProxy() {
  if (process.env.HTTPS_PROXY || process.env.HTTP_PROXY) return;
  const rule = await session.defaultSession.resolveProxy("https://api.anthropic.com");
  const m = /(?:PROXY|HTTPS)\s+([^;\s]+)/.exec(rule);
  if (m) process.env.HTTPS_PROXY = process.env.HTTP_PROXY = `http://${m[1]}`;
}

async function createWindow() {
  await adoptSystemProxy();
  const { startServer } = await import(pathToFileURL(path.join(__dirname, "..", "server", "index.js")).href);
  server = server || (await startServer({ port: 0 }));

  nativeTheme.themeSource = "dark";
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#0f0f0f",
    title: "Fish Harness",
    icon: path.join(__dirname, "icon.png"),
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : { color: "#141414", symbolColor: "#a1a1a1", height: 38 },
    trafficLightPosition: { x: 16, y: 13 },
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
    },
  });
  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(server.url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  await win.loadURL(server.url);
}

ipcMain.handle("fish:pick-folder", async (_e, current) => {
  const res = await dialog.showOpenDialog(win, { properties: ["openDirectory"], defaultPath: current });
  return res.canceled ? null : res.filePaths[0];
});

app.whenReady().then(createWindow);
app.on("window-all-closed", async () => {
  await server?.close();
  app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
