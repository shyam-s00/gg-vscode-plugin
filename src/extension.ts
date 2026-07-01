import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { RunCommands } from './commands';
import { GgHttpCodeLensProvider, GgYamlCodeLensProvider } from './codeLens';
import { GgYamlDefinitionProvider } from './definitionProvider';
import { ScaffoldCommands } from './scaffolding';
import { SnapBrowser } from './snap/snapTreeProvider';
import { Installer } from './installer';
import { RatePrompter } from './ratePrompt';
import { GgRunner } from './runner';
import { RunPanel } from './runPanel';
import { StatusBarManager } from './statusBar';

// This method is called when the extension activates
// (on .http file open or workspace containing .http files).
export function activate(context: vscode.ExtensionContext) {
	console.log('Gopher-Glide extension activated (triggered by .http file or workspace).');

	// 1. Boot config manager — registers gg.selectBinaryPath & gg.checkForUpdates commands.
	const configMgr = ConfigManager.create(context);

	// 2. Boot status bar — shows a spinner immediately, updates after install resolves.
	const statusBar = new StatusBarManager(configMgr);
	context.subscriptions.push(statusBar);

	// 3. Boot installer — plugs real logic into the checkForUpdates command stub.
	const installer = new Installer(context, configMgr);
	context.subscriptions.push(installer);

	// 3b. Boot the headless runner and register gg.run / gg.runConfig.
	//     runner.dispose() stops any in-flight gg process on deactivation.
	const runner = new GgRunner();
	context.subscriptions.push(runner);
	const runCommands = new RunCommands(context, configMgr, installer, runner);
	context.subscriptions.push(runCommands);

	// 3b-ii. Rate-prompt tracker — fires once after 3 clean gg runs.
	context.subscriptions.push(new RatePrompter(context, runner));

	// 3c. Boot the run dashboard — subscribes to `runner` directly and needs no
	//     further wiring; it reveals/resets itself on each new run. Registered
	//     as a WebviewView docked in the bottom panel (see contributes.views in
	//     package.json), not an editor tab, so it doesn't compete for tab space
	//     and survives being hidden via retainContextWhenHidden.
	const runPanel = new RunPanel(runner);
	context.subscriptions.push(runPanel);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(RunPanel.VIEW_ID, runPanel, {
			webviewOptions: { retainContextWhenHidden: true },
		}),
	);

	// 3d. Register CodeLens providers for .http/.rest files and *.gg.yaml configs.
	//     Pattern-based selectors, not `language: 'http'` — that language id is
	//     only registered if some other extension happens to claim it.
	const httpCodeLens = new GgHttpCodeLensProvider();
	context.subscriptions.push(httpCodeLens);
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ pattern: '**/*.{http,rest}' }, httpCodeLens),
	);

	const yamlCodeLens = new GgYamlCodeLensProvider();
	context.subscriptions.push(yamlCodeLens);
	context.subscriptions.push(
		vscode.languages.registerCodeLensProvider({ pattern: '**/*.gg.yaml' }, yamlCodeLens),
	);

	// .gg.yaml language support & scaffolding
	const definitionProvider = new GgYamlDefinitionProvider();
	context.subscriptions.push(definitionProvider);
	context.subscriptions.push(
		vscode.languages.registerDefinitionProvider({ pattern: '**/*.gg.yaml' }, definitionProvider),
	);

	context.subscriptions.push(new ScaffoldCommands());

	// Snapshot browser — Snaps section in the Gopher-Glide panel.
	context.subscriptions.push(new SnapBrowser(configMgr, installer));

	// 4. Ensure the binary is present / up-to-date, then refresh the status bar.
	//    Fire-and-forget so activation is never blocked.
	const runInstallCycle = () => {
		statusBar.setLoading();
		installer
			.ensureInstalled()
			.then(() => statusBar.refresh())
			.catch((err: unknown) => {
				console.error('[Gopher-Glide] ensureInstalled error:', err);
				void statusBar.refresh(); // still try to show real state
			});
	};

	runInstallCycle();

	// 5. Re-run the cycle when settings that affect binary resolution change.
	context.subscriptions.push(
		configMgr.onDidChangeConfig(({ changedKeys }) => {
			if (
				changedKeys.includes('binaryPath') ||
				changedKeys.includes('installationMode')
			) {
				runInstallCycle();
			}
		}),
	);

}

// This method is called when the extension is deactivated.
export function deactivate() {}
