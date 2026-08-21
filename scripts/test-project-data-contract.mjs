import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadProjects, validateProjects } from './lib/projects.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baseProjects = loadProjects(ROOT);
const clone = (value) => JSON.parse(JSON.stringify(value));

const expectRejected = (label, mutate, messagePattern) => {
  const projects = clone(baseProjects);
  mutate(projects[0]);
  assert.throws(() => validateProjects(projects), messagePattern, label);
};

const expectAccepted = (label, mutate) => {
  const projects = clone(baseProjects);
  mutate(projects[0]);
  assert.doesNotThrow(() => validateProjects(projects), label);
};

expectRejected('source label with pipe', (project) => {
  project.sources[0].label = 'Условия | русская версия';
}, /зарезервированы форматом редактора/);

expectRejected('source label with line break', (project) => {
  project.sources[0].label = 'Условия\nрусская версия';
}, /зарезервированы форматом редактора/);

expectRejected('source URL with raw pipe', (project) => {
  project.sources[0].url = 'https://example.com/terms|ru';
}, /зарезервированы форматом редактора/);

expectRejected('changelog note with line break', (project) => {
  project.changelog[0].note = 'Проверены условия\nОбновлён текст';
}, /помещаться в одну строку редактора/);

expectRejected('comma-delimited tag stored as one item', (project) => {
  project.tags = ['Мобильная версия, Поддержка 24/7'];
}, /редактор использует их как разделители/);

expectRejected('line break inside a feature item', (project) => {
  project.features = ['Быстрые выплаты\nПоддержка 24/7'];
}, /редактор использует их как разделители/);

expectAccepted('comma inside a line-based feature', (project) => {
  project.features = ['Быстрые выплаты, если выполнены условия'];
});

for (const logo of [
  'assets/.hidden.svg',
  'assets/images/.hidden.svg',
  'assets/./images/logo.svg',
  'assets//images/logo.svg',
  'Assets/images/logo.svg'
]) {
  expectRejected(`non-canonical logo path ${logo}`, (project) => {
    project.logo = logo;
  }, /logo должен быть путём внутри assets/);
}

expectAccepted('canonical versioned logo path', (project) => {
  project.logo = 'assets/images/projects/example.logo-v2.webp';
});

console.log('Project data contract test: OK — editor delimiters and canonical logo paths validated.');
