// Type-checks one file with the workspace's own TypeScript. Runs in a child
// process so a large program never blocks the Fish server.
// stdin: { ws, file, content }  →  stdout: Diagnostic[]
const path = require("node:path");
const { createRequire } = require("node:module");

let input = "";
process.stdin.on("data", (d) => (input += d));
process.stdin.on("end", () => {
  const { ws, file, content } = JSON.parse(input);
  const ts = createRequire(path.join(ws, "package.json"))("typescript");
  const norm = (p) => path.resolve(p).toLowerCase();
  const target = norm(file);

  const configPath = ts.findConfigFile(path.dirname(file), ts.sys.fileExists, "tsconfig.json") || ts.findConfigFile(path.dirname(file), ts.sys.fileExists, "jsconfig.json");
  let options = { allowJs: true, jsx: ts.JsxEmit.ReactJSX, noEmit: true, skipLibCheck: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler };
  if (configPath) {
    const cfg = ts.readConfigFile(configPath, ts.sys.readFile);
    const parsed = ts.parseJsonConfigFileContent(cfg.config || {}, ts.sys, path.dirname(configPath));
    options = { ...parsed.options, noEmit: true };
  }

  const host = ts.createCompilerHost(options, true);
  const readFile = host.readFile.bind(host);
  host.readFile = (f) => (norm(f) === target ? content : readFile(f));
  const getSourceFile = host.getSourceFile.bind(host);
  host.getSourceFile = (f, lang, onError, create) =>
    norm(f) === target ? ts.createSourceFile(f, content, lang, true) : getSourceFile(f, lang, onError, create);

  const program = ts.createProgram([file], options, host);
  const sf = program.getSourceFiles().find((s) => norm(s.fileName) === target);
  const diags = sf ? [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)] : [];
  const out = diags
    .filter((d) => d.file && d.start != null)
    .map((d) => {
      const s = d.file.getLineAndCharacterOfPosition(d.start);
      const e = d.file.getLineAndCharacterOfPosition(d.start + (d.length || 0));
      return {
        line: s.line + 1, col: s.character + 1, endLine: e.line + 1, endCol: e.character + 1,
        severity: d.category === ts.DiagnosticCategory.Error ? "error" : "warning",
        message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
        source: `ts(${d.code})`,
      };
    });
  process.stdout.write(JSON.stringify(out));
});
