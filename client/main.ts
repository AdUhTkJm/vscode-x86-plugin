import * as path from "path";
import * as vsc from "vscode";
import * as lsp from "vscode-languageclient/node";

let client: lsp.LanguageClient;

export function activate(context: vsc.ExtensionContext) {
  const serverPath = context.asAbsolutePath(path.join("dist", "server.js"));
  vsc.window.showInformationMessage(`NASM X86 extension is enabled.`);

  const serverOpt: lsp.ServerOptions = {
    run: { module: serverPath },
    debug: { module: serverPath }
  };

  const clientOpt: lsp.LanguageClientOptions = {
    documentSelector: [
      { scheme: "file", language: "nasm-x86" }
    ]
  };

  client = new lsp.LanguageClient("x86.client", "NASM X86 Client", serverOpt, clientOpt);
  client.start();
}

export function deactivate() {
  return client?.stop();
}