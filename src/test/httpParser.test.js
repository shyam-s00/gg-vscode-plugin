"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("assert"));
const httpParser_1 = require("../httpParser");
suite('httpParser', () => {
    test('parses a single request file with no separators', () => {
        const [req] = (0, httpParser_1.parseHttpRequests)('GET https://example.com/\n');
        assert.ok(req);
        assert.strictEqual(req.method, 'GET');
        assert.strictEqual(req.url, 'https://example.com/');
        assert.strictEqual(req.name, undefined);
        assert.strictEqual(req.requestLine, 0);
    });
    test('defaults to GET for a bare URL with no method', () => {
        const [req] = (0, httpParser_1.parseHttpRequests)('https://example.com/ping\n');
        assert.ok(req);
        assert.strictEqual(req.method, 'GET');
        assert.strictEqual(req.url, 'https://example.com/ping');
    });
    test('parses a multi-request file with ### separators', () => {
        const text = [
            '### First',
            'GET https://example.com/a',
            '',
            '### Second',
            'POST https://example.com/b',
            'Content-Type: application/json',
            '',
            '{"x":1}',
        ].join('\n');
        const requests = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(requests.length, 2);
        assert.strictEqual(requests[0].name, 'First');
        assert.strictEqual(requests[0].method, 'GET');
        assert.strictEqual(requests[0].url, 'https://example.com/a');
        assert.strictEqual(requests[1].name, 'Second');
        assert.strictEqual(requests[1].method, 'POST');
        assert.strictEqual(requests[1].headers['Content-Type'], 'application/json');
        assert.strictEqual(requests[1].body, '{"x":1}');
    });
    test('parses named requests (### Login)', () => {
        const [req] = (0, httpParser_1.parseHttpRequests)('### Login\nPOST https://example.com/login\n');
        assert.strictEqual(req.name, 'Login');
    });
    test('treats an empty ### separator as unnamed', () => {
        const [req] = (0, httpParser_1.parseHttpRequests)('###\nGET https://example.com/\n');
        assert.strictEqual(req.name, undefined);
    });
    test('parses headers and a multi-line JSON body', () => {
        const text = [
            'POST https://example.com/login',
            'Content-Type: application/json',
            'Authorization: Bearer {{token}}',
            '',
            '{',
            '  "username": "user",',
            '  "password": "pass"',
            '}',
        ].join('\n');
        const [req] = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(req.headers['Content-Type'], 'application/json');
        assert.strictEqual(req.headers['Authorization'], 'Bearer {{token}}');
        assert.strictEqual(req.body, '{\n  "username": "user",\n  "password": "pass"\n}');
    });
    test('parses a trailing @gg-export jsonpath directive after the body', () => {
        const text = [
            '### Login',
            'POST https://example.com/login',
            'Content-Type: application/json',
            '',
            '{ "username": "user" }',
            '',
            '# @gg-export token = jsonpath: $.token',
        ].join('\n');
        const [req] = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(req.body, '{ "username": "user" }');
        assert.strictEqual(req.exports.length, 1);
        assert.deepStrictEqual(req.exports[0], {
            varName: 'token',
            engine: 'jsonpath',
            pattern: '$.token',
            line: req.exports[0].line,
        });
        assert.strictEqual(req.exports[0].line, 6);
    });
    test('parses a regex export directive and a consuming request in a later block', () => {
        const text = [
            '### Login',
            'POST https://example.com/login',
            '',
            '{}',
            '',
            '# @gg-export token = regex: "token":"(\\w+)"',
            '',
            '### Get Profile',
            'GET https://example.com/me',
            'Authorization: Bearer {{token}}',
        ].join('\n');
        const requests = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(requests.length, 2);
        assert.strictEqual(requests[0].exports[0].engine, 'regex');
        assert.strictEqual(requests[0].exports[0].varName, 'token');
        assert.strictEqual(requests[1].headers['Authorization'], 'Bearer {{token}}');
    });
    test('strips a JetBrains-style > {% ... %} response-handler block from the body', () => {
        const text = [
            'POST https://example.com/login',
            '',
            '{}',
            '',
            '> {%',
            '  client.global.set("token", response.body.token);',
            '%}',
        ].join('\n');
        const [req] = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(req.body, '{}');
    });
    test('strips a single-line > {% ... %} response-handler block', () => {
        const text = [
            'GET https://example.com/',
            '',
            'body-line',
            '> {% client.test("ok", () => true); %}',
        ].join('\n');
        const [req] = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(req.body, 'body-line');
    });
    test('ignores a block with no request line (comments/blank only)', () => {
        const text = [
            '### Real request',
            'GET https://example.com/',
            '',
            '### Trailing notes',
            '# just a comment, no request here',
        ].join('\n');
        const requests = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(requests.length, 1);
        assert.strictEqual(requests[0].name, 'Real request');
    });
    test('a request with no body has an empty body string', () => {
        const [req] = (0, httpParser_1.parseHttpRequests)('GET https://example.com/\nAccept: application/json\n');
        assert.strictEqual(req.body, '');
        assert.strictEqual(req.headers['Accept'], 'application/json');
    });
    test('computes lineStart/lineEnd/requestLine for CodeLens placement', () => {
        const text = [
            '### First', // 0
            'GET https://a', // 1
            '', // 2
            '### Second', // 3
            'GET https://b', // 4
        ].join('\n');
        const requests = (0, httpParser_1.parseHttpRequests)(text);
        assert.strictEqual(requests[0].lineStart, 0);
        assert.strictEqual(requests[0].lineEnd, 2);
        assert.strictEqual(requests[0].requestLine, 1);
        assert.strictEqual(requests[1].lineStart, 3);
        assert.strictEqual(requests[1].lineEnd, 4);
        assert.strictEqual(requests[1].requestLine, 4);
    });
});
//# sourceMappingURL=httpParser.test.js.map