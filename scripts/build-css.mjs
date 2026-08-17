import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects, projectThemeCss } from './lib/projects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_SOURCES = [
  'base.css',
  'components.css',
  'home.css',
  'catalog.css',
  'review.css',
  'seo.css',
  'responsive.css',
  'project-themes.css',
  'project-theme-tokens.css',
  'motion.css'
];
const PAGE_BUNDLES = {
  'home-page.css': ['base.css', 'components.css', 'home.css', 'responsive.css', 'project-themes.css', 'project-theme-tokens.css', 'motion.css'],
  'catalog-page.css': ['base.css', 'components.css', 'catalog.css', 'responsive.css', 'project-themes.css', 'project-theme-tokens.css', 'motion.css'],
  'seo-page.css': ['base.css', 'components.css', 'seo.css', 'responsive.css', 'project-themes.css', 'project-theme-tokens.css', 'motion.css'],
  'review-page.css': ['base.css', 'components.css', 'review.css', 'seo.css', 'responsive.css', 'project-themes.css', 'project-theme-tokens.css', 'motion.css']
};

const writeIfChanged = (filePath, content) => {
  if (fs.existsSync(filePath) && fs.readFileSync(filePath, 'utf8') === content) return false;
  fs.writeFileSync(filePath, content);
  return true;
};

export const buildStyles = (projects = loadProjects(ROOT), options = {}) => {
  const cssDirectory = path.join(ROOT, 'css');
  const outputDirectory = path.resolve(options.outputDirectory || cssDirectory);
  fs.mkdirSync(outputDirectory, { recursive: true });
  const themeSource = `/* Сформировано из js/projects-data.js. Не редактировать вручную. */\n${projectThemeCss(projects)}`;
  writeIfChanged(
    path.join(outputDirectory, 'project-theme-tokens.css'),
    themeSource
  );

  const bundleSource = (files) => files.map((file) => {
    const content = file === 'project-theme-tokens.css'
      ? themeSource.trim()
      : fs.readFileSync(path.join(cssDirectory, file), 'utf8').trim();
    return `/* ===== ${file} ===== */\n${content}`;
  }).join('\n\n') + '\n';

  const bundle = bundleSource(STYLE_SOURCES);
  writeIfChanged(path.join(outputDirectory, 'site.css'), bundle);
  Object.entries(PAGE_BUNDLES).forEach(([output, files]) => {
    writeIfChanged(path.join(outputDirectory, output), bundleSource(files));
  });
  return {
    files: STYLE_SOURCES.length,
    bundles: Object.keys(PAGE_BUNDLES).length + 1,
    bytes: Buffer.byteLength(bundle)
  };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = buildStyles();
  console.log(`Built ${result.bundles} CSS bundles from ${result.files} modules (${result.bytes} bytes in full bundle).`);
}
