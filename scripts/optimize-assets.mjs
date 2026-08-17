import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const images = path.join(ROOT, 'assets/images');

const runFfmpeg = (args, input) => {
  const result = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    cwd: ROOT,
    input,
    maxBuffer: 10 * 1024 * 1024
  });
  if (result.error?.code === 'ENOENT') throw new Error('FFmpeg не найден. Добавьте ffmpeg в PATH и повторите команду.');
  if (result.status !== 0) throw new Error(result.stderr?.toString() || 'FFmpeg завершился с ошибкой.');
};

const bannerSource = path.join(images, 'banner-velora.png');
const bannerWidths = [480, 800, 1200, 1672];
bannerWidths.forEach((width) => {
  runFfmpeg([
    '-i', bannerSource,
    '-vf', `scale=${width}:-2:flags=lanczos`,
    '-c:v', 'libwebp', '-quality', '76', '-compression_level', '6', '-preset', 'picture',
    path.join(images, `banner-velora-${width}.webp`)
  ]);
  runFfmpeg([
    '-i', bannerSource,
    '-vf', `scale=${width}:-2:flags=lanczos`,
    '-c:v', 'libaom-av1', '-crf', '36', '-b:v', '0', '-cpu-used', '6', '-still-picture', '1',
    path.join(images, `banner-velora-${width}.avif`)
  ]);
});

const joySvg = fs.readFileSync(path.join(images, 'joy-logo.svg'), 'utf8');
const embeddedPng = joySvg.match(/data:image\/png;base64,([^"']+)/)?.[1];
if (!embeddedPng) throw new Error('В joy-logo.svg не найден встроенный PNG.');
runFfmpeg([
  '-f', 'image2pipe', '-i', 'pipe:0',
  '-vf', 'scale=252:-2:flags=lanczos',
  '-c:v', 'libwebp', '-quality', '84', '-compression_level', '6',
  path.join(images, 'joy-logo.webp')
], Buffer.from(embeddedPng, 'base64'));

const generated = [
  ...bannerWidths.flatMap((width) => [`banner-velora-${width}.webp`, `banner-velora-${width}.avif`]),
  'joy-logo.webp'
];
generated.forEach((file) => {
  const bytes = fs.statSync(path.join(images, file)).size;
  console.log(`${file}: ${(bytes / 1024).toFixed(1)} KiB`);
});
