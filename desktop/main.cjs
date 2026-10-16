// Fish Harness desktop shell: runs the local server in-process and shows the UI.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

let server;
let win;

async function createWindow() {
  const { startServer } = await import(pathToFileURL(path.join(__dirname, "..", "server", "index.js")).href);
  server = server || (await startServer({ port: 0 }));

  nativeTheme.themeSource = "dark";
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 620,
    backgroundColor: "#05070d",
    title: "Fish Harness",
    titleBarStyle: "hidden",
    titleBarOverlay: process.platform === "darwin" ? undefined : { color: "#00000000", symbolColor: "#a3b0c6", height: 40 },
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
