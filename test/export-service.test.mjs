import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { inflateRawSync } from 'node:zlib';
import os from 'node:os';
import path from 'node:path';
import { FileCacheStore } from '../src/core/file-cache-store.mjs';
import { ExportService } from '../src/core/export-service.mjs';

test('exports cached chapters as TXT and EPUB inside the configured export directory', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'fqnovel-export-'));
  const repository = new FileCacheStore({ dataDir });
  try {
    const coverBytes = Buffer.from('fake-jpeg-cover');
    const coverUrl = 'https://p3-sign.fqnovelpic.com/cover.jpg';
    repository.upsertDirectory('book-1', {
      serial_count: '2',
      book_info: { book_id: 'book-1', book_name: '导出测试', author: '作者', thumb_url: coverUrl },
      item_data_list: [
        { item_id: 'chapter-1', title: '第一章', chapter_index: 1 },
        { item_id: 'chapter-2', title: '第二章', chapter_index: 2 }
      ]
    });
    for (let index = 1; index <= 2; index += 1) {
      repository.saveChapter({
        bookId: 'book-1',
        chapterId: `chapter-${index}`,
        chapterIndex: index,
        title: `第${index}章`,
        txtContent: `第${index}章正文\n　　第二段`
      });
    }
    const service = new ExportService({
      repository,
      coverImages: {
        async getDataUrl(url) {
          assert.equal(url, coverUrl);
          return `data:image/jpeg;base64,${coverBytes.toString('base64')}`;
        }
      }
    });
    const txt = service.exportBook('book-1', 'txt');
    const epub = service.exportBook('book-1', 'epub', { cover: await service.loadCover('book-1') });
    const txtContent = await readFile(txt.path, 'utf8');
    const epubContent = await readFile(epub.path);
    const epubEntries = readZipEntries(epubContent);
    const epubFiles = new Map(epubEntries.map((entry) => [entry.name, entry.data.toString('utf8')]));

    assert.match(txtContent, /导出测试/);
    assert.match(txtContent, /第1章正文/);
    assert.match(txtContent, /\r\n　　第1章正文\r\n　　第二段\r\n/);
    assert.doesNotMatch(txtContent, /第一章|第二章/);
    assert.equal(epubEntries[0].name, 'mimetype');
    assert.equal(epubEntries[0].method, 0);
    assert.equal(epubFiles.get('mimetype'), 'application/epub+zip');
    assert.match(epubFiles.get('META-INF/container.xml'), /full-path="EPUB\/package\.opf"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /version="3\.0"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /properties="nav"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /id="stylesheet"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /idref="title-page"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /id="toc-page" href="text\/toc\.xhtml"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /<itemref idref="toc-page"\/>/);
    assert.match(epubFiles.get('EPUB/package.opf'), /properties="cover-image"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /name="cover" content="cover-image"/);
    assert.match(epubFiles.get('EPUB/package.opf'), /idref="cover-page"/);
    assert.match(epubFiles.get('EPUB/nav.xhtml'), /epub:type="cover"/);
    assert.match(epubFiles.get('EPUB/nav.xhtml'), /epub:type="toc"/);
    assert.match(epubFiles.get('EPUB/nav.xhtml'), /href="text\/chapter-00001\.xhtml"/);
    assert.match(epubFiles.get('EPUB/text/toc.xhtml'), /<h1>目录<\/h1>/);
    assert.match(epubFiles.get('EPUB/text/toc.xhtml'), /href="chapter-00001\.xhtml">第1章<\/a>/);
    assert.match(epubFiles.get('EPUB/styles/book.css'), /text-indent:\s*2em/);
    assert.match(epubFiles.get('EPUB/text/title.xhtml'), /epub:type="titlepage"/);
    assert.match(epubFiles.get('EPUB/text/cover.xhtml'), /epub:type="cover"/);
    assert.match(epubFiles.get('EPUB/text/cover.xhtml'), /src="\.\.\/images\/cover\.jpg"/);
    assert.deepEqual(
      epubEntries.find((entry) => entry.name === 'EPUB/images/cover.jpg')?.data,
      coverBytes
    );
    assert.match(epubFiles.get('EPUB/text/chapter-00001.xhtml'), /epub:type="chapter"/);
    assert.match(
      epubFiles.get('EPUB/text/chapter-00001.xhtml'),
      /<h1 epub:type="title">第1章<\/h1>/
    );
    assert.match(epubFiles.get('EPUB/text/chapter-00001.xhtml'), /<p>第1章正文<\/p>/);
    assert.match(epubFiles.get('EPUB/styles/book.css'), /\.chapter h1/);
    assert.equal(path.dirname(txt.path), service.exportsDir);
    assert.equal(path.dirname(epub.path), service.exportsDir);
    assert.equal(path.basename(txt.path), '导出测试 - 作者.txt');
    assert.equal(path.basename(epub.path), '导出测试 - 作者.epub');
  } finally {
    repository.close();
    await rm(dataDir, { recursive: true, force: true });
  }
});

function readZipEntries(buffer) {
  const entries = [];
  let offset = 0;
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const flags = buffer.readUInt16LE(offset + 6);
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const filenameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const filenameStart = offset + 30;
    const filenameEnd = filenameStart + filenameLength;
    const dataStart = filenameEnd + extraLength;
    const dataEnd = dataStart + compressedSize;
    assert.equal(flags & 0x08, 0, 'ZIP entries must declare sizes in their local headers');
    assert.ok(dataEnd <= buffer.length, 'ZIP entry data exceeds the archive size');
    const name = buffer.subarray(filenameStart, filenameEnd).toString('utf8');
    const compressed = buffer.subarray(dataStart, dataEnd);
    const data = method === 0
      ? compressed
      : method === 8
        ? inflateRawSync(compressed)
        : assert.fail(`Unsupported ZIP compression method: ${method}`);
    entries.push({ name, method, data });
    offset = dataEnd;
  }
  return entries;
}
