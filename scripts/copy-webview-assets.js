// Copies colocated webview view files (.html/.css) from src/ into a build
// output directory, preserving their relative path — so readTemplate() and
// resolveAssetUris() (which read/reference dist/<relDir>/view.html and
// style.css via extensionUri) find them at runtime, and so unit tests find
// the same files under out/<relDir>/.
const fs = require('fs');
const path = require('path');

const SRC_ROOT = path.join(__dirname, '..', 'src');

function findAssets(dir, out) {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			findAssets(full, out);
		} else if (entry.name.endsWith('.html') || entry.name.endsWith('.css')) {
			out.push(full);
		}
	}
	return out;
}

function copyWebviewAssets(outRoot) {
	const assets = findAssets(SRC_ROOT, []);
	for (const file of assets) {
		const rel = path.relative(SRC_ROOT, file);
		const dest = path.join(outRoot, rel);
		fs.mkdirSync(path.dirname(dest), { recursive: true });
		fs.copyFileSync(file, dest);
	}
	return assets.length;
}

module.exports = { copyWebviewAssets };

if (require.main === module) {
	const outRoot = process.argv[2];
	if (!outRoot) {
		console.error('Usage: node scripts/copy-webview-assets.js <outDir>');
		process.exit(1);
	}
	const count = copyWebviewAssets(path.resolve(outRoot));
	console.log(`[copy-webview-assets] copied ${count} file(s) into ${outRoot}`);
}
