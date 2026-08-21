import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { listReleaseFiles } from './release-package.mjs';

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_SIGNATURE = 0x06054b50;
const UTF8_FLAG = 0x0800;
const DEFLATE_METHOD = 8;
const DOS_TIME = 0;
const DOS_DATE = 0x0021; // 1980-01-01 00:00:00: одинаково на любой машине.
const compareNames = (left, right) => left === right ? 0 : (left < right ? -1 : 1);

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  crcTable[index] = value >>> 0;
}

const crc32 = (buffer) => {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
};

const assertUInt32 = (value, label) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`${label} не помещается в обычный ZIP32: ${value}`);
  }
};

const makeLocalHeader = ({ nameLength, checksum, compressedSize, size }) => {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(DEFLATE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(compressedSize, 18);
  header.writeUInt32LE(size, 22);
  header.writeUInt16LE(nameLength, 26);
  header.writeUInt16LE(0, 28);
  return header;
};

const makeCentralHeader = ({ nameLength, checksum, compressedSize, size, localOffset }) => {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_FILE_SIGNATURE, 0);
  header.writeUInt16LE(0x0314, 4); // Создано Unix-совместимым ZIP 2.0.
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(DEFLATE_METHOD, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(compressedSize, 20);
  header.writeUInt32LE(size, 24);
  header.writeUInt16LE(nameLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  header.writeUInt32LE(localOffset, 42);
  return header;
};

const makeEndRecord = ({ entries, centralSize, centralOffset }) => {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_SIGNATURE, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(entries, 8);
  record.writeUInt16LE(entries, 10);
  record.writeUInt32LE(centralSize, 12);
  record.writeUInt32LE(centralOffset, 16);
  record.writeUInt16LE(0, 20);
  return record;
};

const assertSafeEntryName = (name) => {
  if (!name || name.includes('\\')) throw new Error(`ZIP entry использует недопустимый разделитель: ${name || '(пусто)'}`);
  if (name.startsWith('/') || /^[a-z]:/i.test(name)) throw new Error(`ZIP entry содержит абсолютный путь: ${name}`);
  if (name.includes('\0')) throw new Error(`ZIP entry содержит нулевой байт: ${name}`);
  if (name.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error(`ZIP entry содержит небезопасный путь: ${name}`);
  }
};

export function createDeterministicZip(sourceDirectory, archiveFile) {
  const sourceRoot = path.resolve(sourceDirectory);
  const output = path.resolve(archiveFile);
  const names = listReleaseFiles(sourceRoot);
  if (!names.length) throw new Error('Нельзя создать пустой релизный ZIP.');
  if (names.length > 0xffff) throw new Error(`Слишком много файлов для ZIP32: ${names.length}`);

  const localParts = [];
  const centralParts = [];
  let localOffset = 0;

  names.forEach((name) => {
    assertSafeEntryName(name);
    const nameBuffer = Buffer.from(name, 'utf8');
    if (nameBuffer.length > 0xffff) throw new Error(`Слишком длинный путь для ZIP: ${name}`);

    const sourceFile = path.join(sourceRoot, ...name.split('/'));
    const content = fs.readFileSync(sourceFile);
    const compressed = zlib.deflateRawSync(content, { level: 9 });
    const checksum = crc32(content);
    [content.length, compressed.length, localOffset].forEach((value, index) => {
      assertUInt32(value, ['Размер файла', 'Размер сжатого файла', 'Смещение файла'][index]);
    });

    const metadata = {
      nameLength: nameBuffer.length,
      checksum,
      compressedSize: compressed.length,
      size: content.length,
      localOffset
    };
    const localHeader = makeLocalHeader(metadata);
    localParts.push(localHeader, nameBuffer, compressed);
    centralParts.push(makeCentralHeader(metadata), nameBuffer);
    localOffset += localHeader.length + nameBuffer.length + compressed.length;
  });

  const centralDirectory = Buffer.concat(centralParts);
  assertUInt32(localOffset, 'Смещение центрального каталога');
  assertUInt32(centralDirectory.length, 'Размер центрального каталога');
  const archive = Buffer.concat([
    ...localParts,
    centralDirectory,
    makeEndRecord({ entries: names.length, centralSize: centralDirectory.length, centralOffset: localOffset })
  ]);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const temporary = `${output}.tmp-${process.pid}`;
  const backup = `${output}.backup-${process.pid}`;
  try {
    fs.writeFileSync(temporary, archive, { flag: 'wx' });
    validateReleaseZip(temporary, sourceRoot);
    if (fs.existsSync(output)) fs.renameSync(output, backup);
    try {
      fs.renameSync(temporary, output);
      fs.rmSync(backup, { force: true });
    } catch (error) {
      if (fs.existsSync(backup) && !fs.existsSync(output)) fs.renameSync(backup, output);
      throw error;
    }
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    if (fs.existsSync(backup)) {
      if (fs.existsSync(output)) fs.rmSync(backup, { force: true });
      else {
        try { fs.renameSync(backup, output); }
        catch (recoveryError) {
          throw new Error(`Не удалось восстановить предыдущий ZIP (${backup}): ${recoveryError.message}`, { cause: error });
        }
      }
    }
    throw error;
  }

  return { archive: output, files: names.length, bytes: archive.length };
}

const findEndRecord = (archive) => {
  const minimumOffset = Math.max(0, archive.length - 65_557);
  for (let offset = archive.length - 22; offset >= minimumOffset; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_SIGNATURE) return offset;
  }
  throw new Error('В ZIP не найдена конечная запись центрального каталога.');
};

export function validateReleaseZip(archiveFile, sourceDirectory) {
  const archivePath = path.resolve(archiveFile);
  const archive = fs.readFileSync(archivePath);
  if (archive.length < 22) throw new Error('ZIP-файл пуст или повреждён.');

  const endOffset = findEndRecord(archive);
  const diskNumber = archive.readUInt16LE(endOffset + 4);
  const centralDisk = archive.readUInt16LE(endOffset + 6);
  const diskEntries = archive.readUInt16LE(endOffset + 8);
  const entriesCount = archive.readUInt16LE(endOffset + 10);
  const centralSize = archive.readUInt32LE(endOffset + 12);
  const centralOffset = archive.readUInt32LE(endOffset + 16);
  const commentLength = archive.readUInt16LE(endOffset + 20);

  if (diskNumber !== 0 || centralDisk !== 0 || diskEntries !== entriesCount) throw new Error('Многодисковый ZIP не поддерживается.');
  if (endOffset + 22 + commentLength !== archive.length) throw new Error('После конечной записи ZIP обнаружены лишние данные.');
  if (centralOffset + centralSize !== endOffset) throw new Error('Центральный каталог ZIP имеет неверные границы.');

  const entries = [];
  const seen = new Set();
  let cursor = centralOffset;
  for (let index = 0; index < entriesCount; index += 1) {
    if (cursor + 46 > endOffset || archive.readUInt32LE(cursor) !== CENTRAL_FILE_SIGNATURE) {
      throw new Error(`Повреждена запись центрального каталога ZIP #${index + 1}.`);
    }

    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const entryCommentLength = archive.readUInt16LE(cursor + 32);
    const localOffset = archive.readUInt32LE(cursor + 42);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd + extraLength + entryCommentLength > endOffset) throw new Error('Имя ZIP entry выходит за границы архива.');

    const name = archive.subarray(nameStart, nameEnd).toString('utf8');
    assertSafeEntryName(name); // В частности, утверждает POSIX '/' непосредственно из ZIP.
    if (seen.has(name)) throw new Error(`ZIP содержит повторяющийся entry: ${name}`);
    seen.add(name);
    if ((flags & UTF8_FLAG) === 0 || (flags & 0x0008) !== 0) throw new Error(`ZIP entry имеет неподдерживаемые флаги: ${name}`);
    if (method !== DEFLATE_METHOD) throw new Error(`ZIP entry использует неподдерживаемое сжатие: ${name}`);

    entries.push({ name, flags, method, checksum, compressedSize, size, localOffset });
    cursor = nameEnd + extraLength + entryCommentLength;
  }
  if (cursor !== endOffset) throw new Error('Размер центрального каталога ZIP не совпадает с его содержимым.');

  const sortedNames = entries.map(({ name }) => name).sort(compareNames);
  if (entries.map(({ name }) => name).join('\n') !== sortedNames.join('\n')) {
    throw new Error('ZIP entries должны быть отсортированы для воспроизводимой сборки.');
  }

  const byOffset = [...entries].sort((left, right) => left.localOffset - right.localOffset);
  let expectedOffset = 0;
  byOffset.forEach((entry) => {
    const offset = entry.localOffset;
    if (offset !== expectedOffset || offset + 30 > centralOffset || archive.readUInt32LE(offset) !== LOCAL_FILE_SIGNATURE) {
      throw new Error(`Повреждён локальный заголовок ZIP entry: ${entry.name}`);
    }
    const localFlags = archive.readUInt16LE(offset + 6);
    const localMethod = archive.readUInt16LE(offset + 8);
    const localChecksum = archive.readUInt32LE(offset + 14);
    const localCompressedSize = archive.readUInt32LE(offset + 18);
    const localSize = archive.readUInt32LE(offset + 22);
    const localNameLength = archive.readUInt16LE(offset + 26);
    const localExtraLength = archive.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + localNameLength;
    const localName = archive.subarray(nameStart, nameEnd).toString('utf8');
    assertSafeEntryName(localName);

    if (localName !== entry.name || localFlags !== entry.flags || localMethod !== entry.method
      || localChecksum !== entry.checksum || localCompressedSize !== entry.compressedSize || localSize !== entry.size) {
      throw new Error(`Локальный и центральный заголовки ZIP не совпадают: ${entry.name}`);
    }

    const compressedStart = nameEnd + localExtraLength;
    const compressedEnd = compressedStart + entry.compressedSize;
    if (compressedEnd > centralOffset) throw new Error(`Содержимое ZIP entry выходит за границы: ${entry.name}`);
    const content = zlib.inflateRawSync(archive.subarray(compressedStart, compressedEnd));
    if (content.length !== entry.size || crc32(content) !== entry.checksum) {
      throw new Error(`Контрольная сумма ZIP entry не совпадает: ${entry.name}`);
    }

    if (sourceDirectory) {
      const sourceFile = path.join(path.resolve(sourceDirectory), ...entry.name.split('/'));
      if (!fs.existsSync(sourceFile) || !fs.readFileSync(sourceFile).equals(content)) {
        throw new Error(`ZIP entry не совпадает с релизным каталогом: ${entry.name}`);
      }
    }
    expectedOffset = compressedEnd;
  });
  if (expectedOffset !== centralOffset) throw new Error('Между файлами и центральным каталогом ZIP есть лишние данные.');

  if (sourceDirectory) {
    const expectedNames = listReleaseFiles(sourceDirectory);
    if (entries.map(({ name }) => name).join('\n') !== expectedNames.join('\n')) {
      throw new Error('Состав ZIP не совпадает с содержимым релизного каталога.');
    }
  }

  return { archive: archivePath, files: entries.length, bytes: archive.length, entries: entries.map(({ name }) => name) };
}
