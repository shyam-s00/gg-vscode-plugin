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
exports.RatePrompter = void 0;
const vscode = __importStar(require("vscode"));
const SUCCESSFUL_RUN_COUNT_KEY = 'gg.successfulRunCount';
const RATE_PROMPTED_KEY = 'gg.ratePromptShown';
const RUNS_BEFORE_PROMPT = 3;
const MARKETPLACE_REVIEW_URL = 'https://marketplace.visualstudio.com/items?itemName=gopherglide.gg-plugin&ssr=false#review-details';
/**
 * Tracks successful headless runs (clean exit, code 0) in `globalState`
 * and shows a one-time "rate the extension" toast after the third.
 *
 * "Successful run" = the process exited cleanly; this does NOT mean all HTTP
 * requests passed — it just means the user exercised the extension's core
 * feature through to completion rather than aborting mid-run.
 */
class RatePrompter {
    context;
    _unsubscribe;
    constructor(context, runner) {
        this.context = context;
        this._unsubscribe = runner.onExit((info) => {
            if (info.code === 0 && info.signal === null) {
                void this._onSuccessfulRun();
            }
        });
    }
    dispose() {
        this._unsubscribe();
    }
    async _onSuccessfulRun() {
        if (this.context.globalState.get(RATE_PROMPTED_KEY, false)) {
            return;
        }
        const count = this.context.globalState.get(SUCCESSFUL_RUN_COUNT_KEY, 0) + 1;
        await this.context.globalState.update(SUCCESSFUL_RUN_COUNT_KEY, count);
        if (count < RUNS_BEFORE_PROMPT) {
            return;
        }
        // Mark as shown before awaiting the user's response so a second run
        // completing while the dialog is open can't trigger a second prompt.
        await this.context.globalState.update(RATE_PROMPTED_KEY, true);
        const choice = await vscode.window.showInformationMessage('Enjoying Gopher-Glide? A quick review helps others find it. ⭐', 'Rate on Marketplace', 'Not Now');
        if (choice === 'Rate on Marketplace') {
            await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_REVIEW_URL));
        }
    }
}
exports.RatePrompter = RatePrompter;
//# sourceMappingURL=ratePrompt.js.map