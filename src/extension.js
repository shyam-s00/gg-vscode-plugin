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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const config_1 = require("./config");
const commands_1 = require("./commands");
const codeLens_1 = require("./codeLens");
const definitionProvider_1 = require("./definitionProvider");
const scaffolding_1 = require("./scaffolding");
const snapDetailPanel_1 = require("./snap/snapDetailPanel");
const snapTreeProvider_1 = require("./snap/snapTreeProvider");
const installer_1 = require("./installer");
const ratePrompt_1 = require("./ratePrompt");
const runner_1 = require("./runner");
const runPanel_1 = require("./runPanel");
const statusBar_1 = require("./statusBar");
// This method is called when the extension activates
// (on .http file open or workspace containing .http files).
function activate(context) {
    console.log('Gopher-Glide extension activated (triggered by .http file or workspace).');
    // 1. Boot config manager — registers gg.selectBinaryPath & gg.checkForUpdates commands.
    const configMgr = config_1.ConfigManager.create(context);
    // 2. Boot status bar — shows a spinner immediately, updates after install resolves.
    const statusBar = new statusBar_1.StatusBarManager(configMgr);
    context.subscriptions.push(statusBar);
    // 3. Boot installer — plugs real logic into the checkForUpdates command stub.
    const installer = new installer_1.Installer(context, configMgr);
    context.subscriptions.push(installer);
    // 3b. Boot the headless runner and register gg.run / gg.runConfig.
    //     runner.dispose() stops any in-flight gg process on deactivation.
    const runner = new runner_1.GgRunner();
    context.subscriptions.push(runner);
    const runCommands = new commands_1.RunCommands(context, configMgr, installer, runner);
    context.subscriptions.push(runCommands);
    // 3b-ii. Rate-prompt tracker — fires once after 3 clean gg runs.
    context.subscriptions.push(new ratePrompt_1.RatePrompter(context, runner));
    // 3c. Boot the run dashboard — subscribes to `runner` directly and needs no
    //     further wiring; it reveals/resets itself on each new run. Registered
    //     as a WebviewView docked in the bottom panel (see contributes.views in
    //     package.json), not an editor tab, so it doesn't compete for tab space
    //     and survives being hidden via retainContextWhenHidden.
    const runPanel = new runPanel_1.RunPanel(runner);
    context.subscriptions.push(runPanel);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(runPanel_1.RunPanel.VIEW_ID, runPanel, {
        webviewOptions: { retainContextWhenHidden: true },
    }));
    // 3d. Register CodeLens providers for .http/.rest files and *.gg.yaml configs.
    //     Pattern-based selectors, not `language: 'http'` — that language id is
    //     only registered if some other extension happens to claim it.
    const httpCodeLens = new codeLens_1.GgHttpCodeLensProvider();
    context.subscriptions.push(httpCodeLens);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ pattern: '**/*.{http,rest}' }, httpCodeLens));
    const yamlCodeLens = new codeLens_1.GgYamlCodeLensProvider();
    context.subscriptions.push(yamlCodeLens);
    context.subscriptions.push(vscode.languages.registerCodeLensProvider({ pattern: '**/*.gg.yaml' }, yamlCodeLens));
    // .gg.yaml language support & scaffolding
    const definitionProvider = new definitionProvider_1.GgYamlDefinitionProvider();
    context.subscriptions.push(definitionProvider);
    context.subscriptions.push(vscode.languages.registerDefinitionProvider({ pattern: '**/*.gg.yaml' }, definitionProvider));
    context.subscriptions.push(new scaffolding_1.ScaffoldCommands());
    // Snapshot browser — Snaps section in the Gopher-Glide panel.
    (0, snapDetailPanel_1.initSnapDetailPanel)(context.extensionUri);
    context.subscriptions.push(new snapTreeProvider_1.SnapBrowser(configMgr, installer));
    // 4. Ensure the binary is present / up-to-date, then refresh the status bar.
    //    Fire-and-forget so activation is never blocked.
    const runInstallCycle = () => {
        statusBar.setLoading();
        installer
            .ensureInstalled()
            .then(() => statusBar.refresh())
            .catch((err) => {
            console.error('[Gopher-Glide] ensureInstalled error:', err);
            void statusBar.refresh(); // still try to show real state
        });
    };
    runInstallCycle();
    // 5. Re-run the cycle when settings that affect binary resolution change.
    context.subscriptions.push(configMgr.onDidChangeConfig(({ changedKeys }) => {
        if (changedKeys.includes('binaryPath') ||
            changedKeys.includes('installationMode')) {
            runInstallCycle();
        }
    }));
}
// This method is called when the extension is deactivated.
function deactivate() { }
//# sourceMappingURL=extension.js.map