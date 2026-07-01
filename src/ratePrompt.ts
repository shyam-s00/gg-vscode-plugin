import * as vscode from 'vscode';

import type { GgRunner } from './runner';

const SUCCESSFUL_RUN_COUNT_KEY = 'gg.successfulRunCount';
const RATE_PROMPTED_KEY = 'gg.ratePromptShown';
const RUNS_BEFORE_PROMPT = 3;

// TODO: update to the real marketplace listing URL once the extension is
// published (replace the placeholder publisher/extension-name segment).
const MARKETPLACE_REVIEW_URL =
  'https://marketplace.visualstudio.com/items?itemName=gopherglide.gopher-glide&ssr=false#review-details';

/**
 * Tracks successful headless runs (clean exit, code 0) in `globalState`
 * and shows a one-time "rate the extension" toast after the third.
 *
 * "Successful run" = the process exited cleanly; this does NOT mean all HTTP
 * requests passed — it just means the user exercised the extension's core
 * feature through to completion rather than aborting mid-run.
 */
export class RatePrompter implements vscode.Disposable {
  private readonly _unsubscribe: () => void;

  constructor(
    private readonly context: vscode.ExtensionContext,
    runner: GgRunner,
  ) {
    this._unsubscribe = runner.onExit((info) => {
      if (info.code === 0 && info.signal === null) {
        void this._onSuccessfulRun();
      }
    });
  }

  dispose(): void {
    this._unsubscribe();
  }

  private async _onSuccessfulRun(): Promise<void> {
    if (this.context.globalState.get<boolean>(RATE_PROMPTED_KEY, false)) {
      return;
    }

    const count = this.context.globalState.get<number>(SUCCESSFUL_RUN_COUNT_KEY, 0) + 1;
    await this.context.globalState.update(SUCCESSFUL_RUN_COUNT_KEY, count);

    if (count < RUNS_BEFORE_PROMPT) {
      return;
    }

    // Mark as shown before awaiting the user's response so a second run
    // completing while the dialog is open can't trigger a second prompt.
    await this.context.globalState.update(RATE_PROMPTED_KEY, true);

    const choice = await vscode.window.showInformationMessage(
      'Enjoying Gopher-Glide? A quick review helps others find it. ⭐',
      'Rate on Marketplace',
      'Not Now',
    );

    if (choice === 'Rate on Marketplace') {
      await vscode.env.openExternal(vscode.Uri.parse(MARKETPLACE_REVIEW_URL));
    }
  }
}
