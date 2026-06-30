import * as vscode from 'vscode';
import { ConfigManager } from './config';
import { RunCommands } from './commands';
import { Installer } from './installer';
import { GgRunner } from './runner';
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
