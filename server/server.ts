/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
import * as lsp from 'vscode-languageserver/node';
import * as doc from 'vscode-languageserver-textdocument';
import { parse } from 'path';

const instructions = [
	// Arithmetic operations
	"adc", "and", "add", "bsf",
	"bsr", "bt", "btr", "bts", "cmp",
	"cmpsb", "cmpsd", "cmpsq", "cmpsw",
	"cupid", "cwd", "cdq", "cdo",
	"dec", "div", "idiv", "imul", "lahf",
	"lea", "lodsb", "lodsw", "lodsd", "lodsq",
	"mov", "movsx", "movsxd", "movzx",
	"mul", "neg", "not", "or", "pop",
	"popfq", "push", "pushfq", "rcl", "rcr",
	"rep", "repe", "repz", "repne", "repnz",
	"rol", "ror", "sahf", "sar", "setcc",
	"shl", "shr", "sbb", "std",
	"stosb", "stosw", "stosd", "stosq",
	"test", "xchg", "xor",

	// Branch instructions
	"jl", "jg", "ja", "jb",
	"jle", "jge", "jae", "jbe",
	"jne", "js", "jns", "jp", "jnp",
	"jc", "jnc", "jo", "jno",
	"jmp",

	// Conditional movements
	"cmovl", "cmovg", "cmova", "cmovb",
	"cmovle", "cmovge",

	// Function calls
	"call", "ret",
];

const registers = [
	// 64-bit
	"rax", "rbx", "rcx", "rdx",
	"rdi", "rsi", "rbp", "rsp",
	"r8", "r9", "r10", "r11",
	"r12", "r13", "r14", "r15",

	// 32-bit
	"eax", "ebx", "ecx", "edx",
	"edi", "esi", "ebp", "esp",
	"r8d", "r9d", "r10d", "r11d",
	"r12d", "r13d", "r14d", "r15d",

	// 16-bit
	"ax", "bx", "cx", "dx",
	"di", "si", "bp", "sp",
	"r8w", "r9w", "r10w", "r11w",
	"r12w", "r13w", "r14w", "r15w",

	// 8-bit
	"al", "bl", "cl", "dl",
	"dil", "sil", "bpl", "spl",
	"r8b", "r9b", "r10b", "r11b",
	"r12b", "r13b", "r14b", "r15b",
];

const types = [
	"dword", "qword", "word", "byte"
];

const directives = [
	"global",
	
	"section", "text", "data", "bss",
];

const tokenTypesLegend = [
	"keyword", "function", "variable", "number",
	"comment", "type", "macro", "operator"
];
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
				range: false,
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

class Token {
	line_no: number;
	start: number;
	type: number;
	modif: number;
	value: string;

	constructor(line_no: number, start: number, value: string, type: number, modif: number) {
		this.line_no = line_no;
		this.start = start;
		this.value = value;
		this.type = type;
		this.modif = modif;
	}

	length() { return this.value.length; }
}

class Instruction {
	operands: Token[];

	constructor(operands: Token[]) {
		this.operands = operands;
	}

	head() { return this.operands[0]; }
	length() { return this.operands.length; }
}

class Diagnostic {
	level: lsp.DiagnosticSeverity;
	message: string;
	start: doc.Position;
	end: doc.Position;
	relatedInfo: string[];

	constructor(level: lsp.DiagnosticSeverity, message: string, begin: Token, end?: Token, relatedInfo?: string[]) {
		// If only `begin` is provided, then this is for single token
		end = end ?? begin;

		this.level = level;
		this.message = message;
		this.start = { line: begin.line_no, character: begin.start };
		this.end = { line: end.line_no, character: end.start + end.length() };
		this.relatedInfo = relatedInfo ?? [];
	}
}

connection.languages.diagnostics.on(async (params) => {
	const document = documents.get(params.textDocument.uri);
	if (document !== undefined) {
		return {
			kind: lsp.DocumentDiagnosticReportKind.Full,
			items: await sendDiagnostics(document)
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
	sendDiagnostics(change.document);
});

let diagnostics: Diagnostic[] | null = null;

/**
 * Read from global variable `diagnostics` and convert them to the format
 * which the client can understand.
 * 
 * @param source The source file.
 * @returns Diagnostics to send to client.
 */
async function sendDiagnostics(source: doc.TextDocument): Promise<lsp.Diagnostic[]> {
	if (diagnostics === null) {
		// Hasn't processed yet. Call functions to process this.
		computeSemanticTokens(source.uri);
	}

	const diags: lsp.Diagnostic[] = [];
	for (let x of diagnostics!) {
		const diagnostic: lsp.Diagnostic = {
			severity: x.level,
			range: {
				start: x.start,
				end: x.end,
			},
			message: x.message,
			source: "x86"
		};
		if (x.relatedInfo.length) {
			diagnostic.relatedInformation = [];
			for (let info of x.relatedInfo) {
				diagnostic.relatedInformation.push({
					location: {
						uri: source.uri,
						range: Object.assign({}, diagnostic.range)
					},
					message: info,
				});
			}
		}
		diags.push(diagnostic);
	}

	// Sent. Let's flush all diagnostics.
	diagnostics = null;
	return diags;
}

function splitLine(tokens: Token[]): Instruction[] {
	// Split each line.
	let lines = [];
	let curInst = [];
	let curLine = 0;
	for (let x of tokens) {
		if (x.line_no !== curLine) {
			curLine = x.line_no;
			lines.push(curInst);
		}

		// Remove comments.
		if (x.type !== tokenTypes.comment)
			curInst.push(x);
	}
	// The final push is not done yet, do it now
	lines.push(curInst);

	return lines.map((x) => new Instruction(x));
}

let labels = [];

// We don't need AST, as x86 is quite straightforward.
function semanticsAnalysis(tokens: Token[]) {
	let inst = splitLine(tokens);
	if (diagnostics === null)
		diagnostics = [];

	for (let x of inst) {
		let type = x.head().type;

		// An instruction.
		if (type === tokenTypes.keyword) {

		}

		// Probably a label.
		if (type === -1) {
			// Expect a colon and nothing else.
			if (x.length() > 2) {
				diagnostics.push(new Diagnostic(lsp.DiagnosticSeverity.Error, "unexpected content after label", x.operands[2], x.operands[x.length() - 1]));
				continue;
			}

			// Must have a colon after it
			if (x.length() === 1 || x.operands[1].value !== ":") {
				diagnostics.push(new Diagnostic(lsp.DiagnosticSeverity.Error, "missing semicolon for labels", x.head()));
				continue;
			}

			labels.push(x.head());
			x.head().type = tokenTypes.function;
		}
	}
}

function computeSemanticTokens(uri: string) {
	const text = documents.get(uri)?.getText()!;

	let tokens: Token[] = [];
	let lines = text.split("\n");

	// We implement a small tokenizer.
	lines.forEach((line, line_no) => {
        let i = 0;
        while (i < line.length) {
            let remains = line.slice(i);

			// comment
			if (remains.startsWith(";")) {
				tokens.push(new Token(line_no, i, remains, tokenTypes.comment, 0));
				break;
			}

            // digit (immediate)
            let matchImm = remains.match(/^\d+/);
            if (matchImm) {
                let str = matchImm[0];
                tokens.push(new Token(line_no, i, str, tokenTypes.number, 0));
                i += str.length;
                continue;
            }

            // identifier (register or operation)
            let matchId = remains.match(/^[_\w]+/);
            if (matchId) {
                let str = matchId[0];
				let type: number;

				if (instructions.includes(str))
				 	type = tokenTypes.keyword;
				
				else if (registers.includes(str))
					type = tokenTypes.variable;

				else if (types.includes(str))
					type = tokenTypes.type;

				else if (directives.includes(str))
					type = tokenTypes.macro;

				else // Unknown type, any identifier is possible
					type = -1;

				tokens.push(new Token(line_no, i, str, type, 0));
                i += str.length;
                continue;
            }

			// A single character, as an operator
			let x = remains.charAt(0);

			if (x === "[" || x === "]" || x === ":") {
				tokens.push(new Token(line_no, i, x, tokenTypes.operator, 0));
				// [[fallthrough]]
			}

            // Unrecognized character, just skip
            i++;
        }
	});

	semanticsAnalysis(tokens);
	
	// we must convert them to relative position.
	// the original array is already sorted according to (line, char_start).
	let currentLine = 0;
	let currentChar = 0;

	let relative = [];

	for (let x of tokens) {
		let deltaLine = x.line_no - currentLine;
		if (deltaLine > 0) {
			currentLine = x.line_no;
			currentChar = 0;
		}

		let deltaStart = x.start - currentChar;
		currentChar = x.start;

		relative.push(deltaLine, deltaStart, x.value.length, x.type, x.modif);
	}
	return relative;
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
