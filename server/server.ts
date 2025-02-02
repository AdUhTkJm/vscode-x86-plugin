/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as lsp from 'vscode-languageserver/node';
import * as doc from 'vscode-languageserver-textdocument';
import { CompletionItem } from 'vscode';

// Create a connection for the server, using Node's IPC as a transport.
// Also include all preview / proposed LSP features.
const connection = lsp.createConnection(lsp.ProposedFeatures.all);
const documents = new lsp.TextDocuments(doc.TextDocument);

let hasCompletion = false;

connection.onInitialize((params: lsp.InitializeParams) => {
	const capabilities = params.capabilities;

	hasCompletion = !!capabilities.textDocument?.completion;

	const result: lsp.InitializeResult = {
		capabilities: {
			textDocumentSync: lsp.TextDocumentSyncKind.Incremental,
			// Tell the client that this server supports code completion.
			completionProvider: {
				resolveProvider: true
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			}
		}
	};
	
	return result;
});

connection.onInitialized(() => {
	connection.console.log("NASM X86 LSP initialized.");
});

// The example settings
interface ExampleSettings {
	maxNumberOfProblems: number;
}

connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		return {
			kind: lsp.DocumentDiagnosticReportKind.Full,
			items: await validateTextDocument(document)
		} satisfies lsp.DocumentDiagnosticReport;
	} else {
		// We don't know the document. We can either try to read it from disk
		// or we don't report problems for it.
		return {
			kind: lsp.DocumentDiagnosticReportKind.Full,
			items: []
		} satisfies lsp.DocumentDiagnosticReport;
	}
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent(change => {
	validateTextDocument(change.document);
});

async function validateTextDocument(textDocument: doc.TextDocument): Promise<lsp.Diagnostic[]> {
	// The validator creates diagnostics for all uppercase words length 2 and more
	const text = textDocument.getText();
	const pattern = /\b[A-Z]{2,}\b/g;
	let m: RegExpExecArray | null;

	let problems = 0;
	const diagnostics: lsp.Diagnostic[] = [];
	while ((m = pattern.exec(text)) && problems < 10) {
		problems++;
		const diagnostic: lsp.Diagnostic = {
			severity: lsp.DiagnosticSeverity.Warning,
			range: {
				start: textDocument.positionAt(m.index),
				end: textDocument.positionAt(m.index + m[0].length)
			},
			message: `${m[0]} is all uppercase.`,
			source: 'ex'
		};
		diagnostic.relatedInformation = [
			{
				location: {
					uri: textDocument.uri,
					range: Object.assign({}, diagnostic.range)
				},
				message: 'Spelling matters'
			},
			{
				location: {
					uri: textDocument.uri,
					range: Object.assign({}, diagnostic.range)
				},
				message: 'Particularly for names'
			}
		];
		diagnostics.push(diagnostic);
	}
	return diagnostics;
}

connection.onCompletion((_textPos: lsp.TextDocumentPositionParams): lsp.CompletionItem[] => {
	if (!hasCompletion)
		return [];

	return [{
		label: "add",
		kind: lsp.CompletionItemKind.Keyword,
	}];
});

// No need to resolve currently
connection.onCompletionResolve((item: lsp.CompletionItem): lsp.CompletionItem => {
	return item;
});

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received a file change event');
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();