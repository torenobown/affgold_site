import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseDirectory } from './lib/release-package.mjs';
import { createDeterministicZip, validateReleaseZip } from './lib/release-zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIRECTORY = path.join(ROOT, 'beget-upload');
const ARCHIVE = path.join(ROOT, 'affgold-beget.zip');
let temporaryDirectory;

try {
  const release = validateReleaseDirectory(RELEASE_DIRECTORY);
  const checkedArchive = validateReleaseZip(ARCHIVE, RELEASE_DIRECTORY);

  temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'affgold-release-check-'));
  const reproducedArchive = path.join(temporaryDirectory, 'affgold-beget.zip');
  createDeterministicZip(RELEASE_DIRECTORY, reproducedArchive);
  if (!fs.readFileSync(ARCHIVE).equals(fs.readFileSync(reproducedArchive))) {
    throw new Error('Повторная упаковка дала другой ZIP: сборка не является воспроизводимой.');
  }

  console.log(`Release check: OK — ${release.files.length} файлов, ${release.htmlFiles} HTML.`);
  console.log(`Build ID: ${release.buildId}`);
  console.log(`ZIP check: OK — ${checkedArchive.files} POSIX entries, ${checkedArchive.bytes} байт, сборка воспроизводима.`);
} catch (error) {
  console.error(`Release check: ERROR — ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
}
