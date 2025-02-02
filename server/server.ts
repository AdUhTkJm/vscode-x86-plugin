/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as lsp from 'vscode-languageserver/node';
import * as doc from 'vscode-languageserver-textdocument';

const instructions = [
	// Arithmetic operations
	"add", "sub", "mov",

	// Branch instructions
	"jl", "jg", "ja", "jb",
	"jle", "jge",

	// Jump instructions
	"jmp",

	// Function calls
	"call", "ret",
];

const registers = [
	// 64-bit
	"rax", "rbx",

	// 32-bit
	"eax", "ebx",
];

const tokenTypesLegend = ["keyword", "function", "variable", "number", "label"];
const tokenModifiersLegend = ["declaration", "readonly", "deprecated"];

const tokenTypes: { [x: string]: number } = {};
const tokenModifiers: { [x: string]: number } = {};

// Initialize
tokenTypesLegend.forEach((x, i) => tokenTypes[x] = i);
tokenModifiersLegend.forEach((x, i) => tokenModifiers[x] = i);

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
				resolveProvider: false
			},
			diagnosticProvider: {
				interFileDependencies: false,
				workspaceDiagnostics: false
			},
			semanticTokensProvider: {
				legend: {
					tokenTypes: tokenTypesLegend,
					tokenModifiers: tokenModifiersLegend,
				},
				full: {
					delta: true
				}
			},
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

// No need to resolve currently; add it when needed
// connection.onCompletionResolve(...)

connection.onDidChangeWatchedFiles(_change => {
	// Monitored files have change in VSCode
	connection.console.log('We received a file change event');
});

const prevTokens = new Map<string, number[]>();

/**
 * 
 * @return the format is a one-dimensional array, where each token
 * is represented by 5 consecutive integers:
 * 
 * - **line**: line of this token
 * - **startChar**: place where this token starts
 * - **length**: length of this token
 * - **tokenType**: token type
 * - **tokenModifier**: token modifier
 * */
function computeSemanticTokens(uri: string) {
	const text = documents.get(uri)?.getText()!;

	let tokens: number[] = [];
	let lines = text.split("\n");

	// We implement a small tokenizer.
	lines.forEach((line, line_no) => {
        let i = 0;
        while (i < line.length) {
            let remains = line.slice(i);

            // digit (immediate)
            let matchImm = remains.match(/^\d+/);
            if (matchImm) {
                let str = matchImm[0];
                tokens.push(line_no, i, str.length, tokenTypes.number, 0);
                i += str.length;
                continue;
            }

            // identifier (register or operation)
            let matchId = remains.match(/^\w+/);
            if (matchId) {
                let str = matchId[0];
				tokens.push(line_no, i, str.length);

				if (instructions.includes(str))
					tokens.push(tokenTypes.keyword, 0);
				
				else if (registers.includes(str))
					tokens.push(tokenTypes.variable, 0);

				// Otherwise, this is a label
				else
					tokens.push(tokenTypes.label, 0);

                i += str.length;
                continue;
            }

            // Unrecognized character, just skip
            i++;
        }
	});
	return tokens;
}

function computeTokenDelta(before: number[], after: number[]) {
	let edits = [];

    // find the first mismatch index
    let minLen = Math.min(before.length, after.length);
    let mismatch = 0;
    while (mismatch < minLen && before[mismatch] === after[mismatch])
        mismatch++;

    // everything the same; no delta
    if (mismatch === before.length && mismatch === after.length)
        return [];

    // find the last mismatch index
    let beforeEnd = before.length;
    let afterEnd = after.length;
    while (beforeEnd > mismatch && afterEnd > mismatch && before[beforeEnd - 1] === after[afterEnd - 1])
        beforeEnd--, afterEnd--;

    // replace the tokens
    edits.push({
        start: mismatch,
        deleteCount: beforeEnd - mismatch,
        data: after.slice(mismatch, afterEnd)
    });

    return edits;
}

connection.languages.semanticTokens.on((params: lsp.SemanticTokensParams) => {
	const uri = params.textDocument.uri;
    const tokens = computeSemanticTokens(uri);
    prevTokens.set(uri, tokens);
    return { data: tokens };
});

connection.languages.semanticTokens.onDelta((params: lsp.SemanticTokensDeltaParams) => {
    const uri = params.textDocument.uri;
    const before = prevTokens.get(uri) ?? [];
    const after = computeSemanticTokens(uri);

    const delta = computeTokenDelta(before, after);

    prevTokens.set(uri, after);

    return { edits: delta };
});

// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

// Listen on the connection
connection.listen();
