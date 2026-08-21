import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { releaseBuildId, writeReleaseManifest } from './lib/release-package.mjs';
import { injectProjectRedirects, projectQueryRedirectRules, projectRedirectRules } from './lib/release-redirects.mjs';
import { createDeterministicZip, validateReleaseZip } from './lib/release-zip.mjs';

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'affgold-zip-test-'));
const source = path.join(temporaryRoot, 'source');
const firstArchive = path.join(temporaryRoot, 'first.zip');
const secondArchive = path.join(temporaryRoot, 'second.zip');

try {
  fs.mkdirSync(path.join(source, 'nested'), { recursive: true });
  fs.mkdirSync(path.join(source, 'кириллица'), { recursive: true });
  fs.writeFileSync(path.join(source, '.htaccess'), 'RewriteEngine On\n');
  fs.writeFileSync(path.join(source, 'nested', 'file.txt'), 'AFFGOLD release fixture\n');
  fs.writeFileSync(path.join(source, 'кириллица', 'файл.txt'), 'UTF-8 path\n');

  createDeterministicZip(source, firstArchive);
  createDeterministicZip(source, secondArchive);
  assert.ok(fs.readFileSync(firstArchive).equals(fs.readFileSync(secondArchive)), 'Повторные ZIP должны быть побайтово одинаковыми');
  const beforeReplacement = fs.readFileSync(firstArchive);
  createDeterministicZip(source, firstArchive);
  assert.ok(beforeReplacement.equals(fs.readFileSync(firstArchive)), 'Безопасная замена существующего ZIP должна сохранять результат');

  const checked = validateReleaseZip(firstArchive, source);
  assert.equal(checked.files, 3);
  assert.ok(checked.entries.every((entry) => !entry.includes('\\')), 'Все ZIP entries должны использовать POSIX-разделители');
  assert.ok(checked.entries.includes('nested/file.txt'));

  const malformed = fs.readFileSync(firstArchive);
  const originalName = Buffer.from('nested/file.txt');
  const malformedName = Buffer.from('nested\\file.txt');
  let replacements = 0;
  let offset = 0;
  while ((offset = malformed.indexOf(originalName, offset)) !== -1) {
    malformedName.copy(malformed, offset);
    replacements += 1;
    offset += originalName.length;
  }
  assert.equal(replacements, 2, 'Имя entry должно находиться в локальном и центральном заголовках');
  const malformedArchive = path.join(temporaryRoot, 'backslash.zip');
  fs.writeFileSync(malformedArchive, malformed);
  assert.throws(() => validateReleaseZip(malformedArchive), /разделитель/);

  fs.writeFileSync(path.join(source, 'nested', 'file.txt'), 'changed after packaging\n');
  assert.throws(() => validateReleaseZip(firstArchive, source), /не совпадает с релизным каталогом/);
  const manifest = writeReleaseManifest(source, [{ id: 'fixture', slug: 'fixture' }]);
  assert.equal(manifest.buildId, releaseBuildId(source, manifest.publishedProjects));
  assert.equal(manifest.fileCount, 4);

  const published = { id: 'new', name: 'New', slug: 'new-review', status: 'published', redirectAliases: ['/reviews/old-review/'] };
  const draft = { id: 'draft', name: 'Draft', slug: 'draft', status: 'draft', redirectAliases: ['/reviews/draft-old/'] };
  const rules = projectRedirectRules([published, draft]);
  assert.equal(rules.length, 1, 'Draft aliases must not be published');
  assert.ok(rules[0].includes('^reviews/old-review/?$ https://affgoldprod.com/reviews/new-review/'));
  const legacyRule = projectRedirectRules([
    { id: 'joycasino', name: 'Joy', slug: 'joy-new', status: 'published', redirectAliases: [] }
  ]);
  assert.equal(legacyRule.length, 1);
  assert.ok(legacyRule[0].includes('^joycasino\\.html$ https://affgoldprod.com/reviews/joy-new/'));
  const injected = injectProjectRedirects('# AFFGOLD:PROJECT_REDIRECTS:START\n# AFFGOLD:PROJECT_REDIRECTS:END', [published, draft]);
  assert.equal(injected.rules, 1);
  assert.equal(injected.queryRules, 1);
  assert.equal(injected.hiddenRules, 3);
  assert.match(injected.source, /Generated publication gates/);
  assert.match(injected.source, /project=\(\?:new\|new-review\)/);
  assert.match(injected.source, /\^reviews\/draft\(\?:\/\.\*\)\?\$/);
  assert.throws(() => projectRedirectRules([
    published,
    { id: 'other', name: 'Other', slug: 'other', status: 'published', redirectAliases: ['/reviews/old-review'] }
  ]), /дублирует/);
  assert.throws(() => projectRedirectRules([
    { ...published, redirectAliases: ['/reviews/new-review/'] }
  ]), /каноническим обзором/);
  assert.throws(() => projectRedirectRules([
    { ...published, redirectAliases: ['/joycasino.html'] }
  ]), /конфликтует/);
  assert.throws(() => projectRedirectRules([
    { ...published, redirectAliases: ['/catalog.html'] }
  ], { reservedPaths: ['/catalog.html'] }), /опубликованным URL/);
  assert.throws(() => projectRedirectRules([
    { ...published, redirectAliases: ['//outside.example/path'] }
  ]), /недопустимый/);
  assert.throws(() => projectQueryRedirectRules([
    published,
    { id: 'other', name: 'Other', slug: 'new', status: 'published', redirectAliases: [] }
  ]), /query redirect/);

  console.log('Release unit test: OK — ZIP reproducibility/POSIX/CRC and redirect safety validated.');
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
