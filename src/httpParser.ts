// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

/** File extensions gg treats as `.http`-dialect request files. */
export const HTTP_FILE_EXTENSIONS = new Set(['.http', '.rest']);

/** A `# @gg-export <var> = <jsonpath|regex>: <pattern>` directive found in a request block. */
export interface HttpExportDirective {
  varName: string;
  engine: 'jsonpath' | 'regex';
  pattern: string;
  /** 0-based line number where this directive appears. */
  line: number;
}

export interface HttpRequest {
  /** Optional name from the `### Name` separator. */
  name?: string;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  /** 0-based line where this request's block begins (its `###` separator, or document start). */
  lineStart: number;
  /** 0-based line where this request's block ends (inclusive) — the line before the next `###`, or EOF. */
  lineEnd: number;
  /** 0-based line of the `METHOD url` request line itself — where a CodeLens/gutter icon should anchor. */
  requestLine: number;
  /** `@gg-export` directives found anywhere in this request's block (used for journey-chaining tooling later). */
  exports: HttpExportDirective[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal patterns
// ─────────────────────────────────────────────────────────────────────────────

const SEPARATOR_RE = /^###\s*(.*)$/;
const EXPORT_RE = /^#\s*@gg-export\s+(\w+)\s*=\s*(jsonpath|regex)\s*:\s*(.+?)\s*$/i;
const COMMENT_RE = /^(#|\/\/)/;
const RESPONSE_HANDLER_START_RE = /^>\s*\{%/;
const HEADER_RE = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/;

const HTTP_METHODS = new Set([
  'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'CONNECT', 'TRACE',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Parsing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parses `.http`/`.rest` file text into a list of `HttpRequest`s.
 *
 * Takes plain text rather than a `vscode.TextDocument` so it stays unit-
 * testable without the VS Code test host; callers with a document just pass
 * `document.getText()`.
 *
 * Handles the gg-specific dialect on top of the standard format:
 *  - `### <optional name>` request separators
 *  - `METHOD url` request lines (method defaults to GET for a bare URL)
 *  - headers, then a blank line, then a body
 *  - `# @gg-export <var> = <jsonpath|regex>: <pattern>` directives, which can
 *    appear before, within, or after a request's headers/body
 *  - JetBrains-style `> {% ... %}` response-handler blocks, which gg ignores
 *    and this parser strips rather than treating as body content
 *
 * There is deliberately no per-request run targeting in the data model:
 * `gg` always executes a whole `.http` file's journeys together (see
 * vscode-extension-plan.md), so `lineStart`/`lineEnd`/`requestLine` exist
 * purely for CodeLens placement, not for building a "run just this request"
 * command.
 */
export function parseHttpRequests(text: string): HttpRequest[] {
  const lines = text.split(/\r\n|\r|\n/);
  const blockStarts: Array<{ line: number; name?: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const m = SEPARATOR_RE.exec(lines[i]);
    if (m) {
      blockStarts.push({ line: i, name: m[1].trim() || undefined });
    }
  }

  // No `###` at all, or content before the first one: treat the document
  // start as an implicit first block boundary.
  if (blockStarts.length === 0 || blockStarts[0].line > 0) {
    blockStarts.unshift({ line: 0, name: undefined });
  }

  const requests: HttpRequest[] = [];
  for (let b = 0; b < blockStarts.length; b++) {
    const lineStart = blockStarts[b].line;
    const lineEnd = b + 1 < blockStarts.length ? blockStarts[b + 1].line - 1 : lines.length - 1;
    const request = parseBlock(lines, lineStart, lineEnd, blockStarts[b].name);
    if (request) {
      requests.push(request);
    }
  }
  return requests;
}

/** Parses one `###`-delimited block. Returns `undefined` if it contains no request line (e.g. trailing comments only). */
function parseBlock(
  lines: string[],
  lineStart: number,
  lineEnd: number,
  name: string | undefined,
): HttpRequest | undefined {
  let requestLine = -1;
  let method = '';
  let url = '';
  const headers: Record<string, string> = {};
  const bodyLines: string[] = [];
  const exports: HttpExportDirective[] = [];

  type Phase = 'seeking-request' | 'headers' | 'body';
  let phase: Phase = 'seeking-request';

  const contentStart = SEPARATOR_RE.test(lines[lineStart]) ? lineStart + 1 : lineStart;

  for (let i = contentStart; i <= lineEnd; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();

    const exportMatch = EXPORT_RE.exec(trimmed);
    if (exportMatch) {
      exports.push({
        varName: exportMatch[1],
        engine: exportMatch[2].toLowerCase() as 'jsonpath' | 'regex',
        pattern: exportMatch[3],
        line: i,
      });
      continue;
    }

    if (RESPONSE_HANDLER_START_RE.test(trimmed)) {
      // Skip the embedded `> {% ... %}` block (JetBrains response-handler script);
      // gg doesn't execute it, so we don't model its contents at all.
      while (i <= lineEnd && !lines[i].includes('%}')) {
        i++;
      }
      continue;
    }

    if (phase === 'seeking-request') {
      if (!trimmed || COMMENT_RE.test(trimmed)) {
        continue;
      }
      const parsed = parseRequestLine(trimmed);
      if (parsed) {
        method = parsed.method;
        url = parsed.url;
        requestLine = i;
        phase = 'headers';
      }
      continue;
    }

    if (phase === 'headers') {
      if (!trimmed) {
        phase = 'body';
        continue;
      }
      if (COMMENT_RE.test(trimmed)) {
        continue;
      }
      const header = HEADER_RE.exec(trimmed);
      if (header) {
        headers[header[1]] = header[2];
        continue;
      }
      // Doesn't look like a header — treat it as the first line of a body with no blank-line separator.
      phase = 'body';
      bodyLines.push(raw);
      continue;
    }

    // phase === 'body'
    // Trailing `#`/`//` comments are treated as stripped metadata rather than body
    // content — a deliberate simplification, since this is an editor-tooling parser,
    // not gg's own (which knows the real body length from Content-Length/parsing).
    if (COMMENT_RE.test(trimmed)) {
      continue;
    }
    bodyLines.push(raw);
  }

  if (requestLine === -1) {
    return undefined;
  }

  while (bodyLines.length > 0 && bodyLines[bodyLines.length - 1].trim() === '') {
    bodyLines.pop();
  }

  return {
    name,
    method,
    url,
    headers,
    body: bodyLines.join('\n'),
    lineStart,
    lineEnd,
    requestLine,
    exports,
  };
}

function parseRequestLine(trimmed: string): { method: string; url: string } | undefined {
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2 && HTTP_METHODS.has(parts[0].toUpperCase())) {
    return { method: parts[0].toUpperCase(), url: parts.slice(1).join(' ') };
  }
  if (parts.length === 1 && /^(https?:\/\/|\/|\{\{)/i.test(parts[0])) {
    return { method: 'GET', url: parts[0] };
  }
  return undefined;
}
