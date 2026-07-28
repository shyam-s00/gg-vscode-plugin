const esbuild = require("esbuild");
const fs = require('fs');
const path = require('path');
const { copyWebviewAssets } = require('./scripts/copy-webview-assets');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

/** Finds src/**\/client.ts — each is a browser-context entry point for a webview panel. */
function findClientEntryPoints(dir) {
	const results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results.push(...findClientEntryPoints(full));
		} else if (entry.name === 'client.ts') {
			results.push(full);
		}
	}
	return results;
}

/** @type {import('esbuild').Plugin} */
const copyWebviewAssetsPlugin = {
	name: 'copy-webview-assets',
	setup(build) {
		build.onEnd(() => { copyWebviewAssets(path.join(__dirname, 'dist')); });
	},
};

/**
 * @type {import('esbuild').Plugin}
 */
const esbuildProblemMatcherPlugin = {
	name: 'esbuild-problem-matcher',

	setup(build) {
		build.onStart(() => {
			console.log('[watch] build started');
		});
		build.onEnd((result) => {
			result.errors.forEach(({ text, location }) => {
				console.error(`✘ [ERROR] ${text}`);
				console.error(`    ${location.file}:${location.line}:${location.column}:`);
			});
			console.log('[watch] build finished');
		});
	},
};

async function main() {
	const ctx = await esbuild.context({
		entryPoints: [
			'src/extension.ts'
		],
		bundle: true,
		format: 'cjs',
		minify: production,
		sourcemap: !production,
		sourcesContent: false,
		platform: 'node',
		outfile: 'dist/extension.js',
		external: ['vscode'],
		logLevel: 'silent',
		plugins: [
			/* add to the end of plugins array */
			esbuildProblemMatcherPlugin,
			copyWebviewAssetsPlugin,
		],
	});

	// Browser-context bundle for webview client scripts (one entry per panel
	// that has interactive client-side behavior). Optional: no-op until the
	// first client.ts file exists.
	const clientEntryPoints = findClientEntryPoints(path.join(__dirname, 'src'));
	const webviewCtx = clientEntryPoints.length
		? await esbuild.context({
			entryPoints: clientEntryPoints,
			bundle: true,
			format: 'iife',
			minify: production,
			sourcemap: !production,
			sourcesContent: false,
			platform: 'browser',
			outdir: 'dist',
			outbase: 'src',
			logLevel: 'silent',
			plugins: [esbuildProblemMatcherPlugin],
		})
		: undefined;

	if (watch) {
		await Promise.all([ctx.watch(), webviewCtx?.watch()].filter(Boolean));
	} else {
		await Promise.all([ctx.rebuild(), webviewCtx?.rebuild()].filter(Boolean));
		await Promise.all([ctx.dispose(), webviewCtx?.dispose()].filter(Boolean));
	}
}

main().catch(e => {
	console.error(e);
	process.exit(1);
});
