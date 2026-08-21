import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseDirectory } from './lib/release-package.mjs';
import { createDeterministicZip, validateReleaseZip } from './lib/release-zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RELEASE_DIRECTORY = path.join(ROOT, 'beget-upload');
const ARCHIVE = path.join(ROOT, 'affgold-beget.zip');

try {
  validateReleaseDirectory(RELEASE_DIRECTORY);
  const created = createDeterministicZip(RELEASE_DIRECTORY, ARCHIVE);
  validateReleaseZip(ARCHIVE, RELEASE_DIRECTORY);
  console.log(`Готов ZIP: ${created.archive}`);
  console.log(`Проверено: ${created.files} файлов, POSIX-пути, CRC32 и соответствие каталогу (${created.bytes} байт).`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
