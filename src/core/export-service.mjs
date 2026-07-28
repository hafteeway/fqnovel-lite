import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createZip } from './zip-writer.mjs';
import { CoverImageService } from './cover-image-service.mjs';

const EPUB_MIMETYPE = 'application/epub+zip';
const EPUB_ROOT = 'EPUB';
const EPUB_PACKAGE_PATH = `${EPUB_ROOT}/package.opf`;
const EPUB_STYLESHEET_PATH = `${EPUB_ROOT}/styles/book.css`;

export class ExportService {
  constructor(options = {}) {
    if (!options.repository) throw new Error('ExportService requires a repository');
    this.repository = options.repository;
    this.coverImages = options.coverImages || new CoverImageService({ maxEntries: 1 });
    this.exportsDir = path.resolve(options.exportsDir || path.join(this.repository.dataDir, 'exports'));
    mkdirSync(this.exportsDir, { recursive: true });
  }

  async loadCover(bookId) {
    const book = this.repository.getBook(bookId);
    if (!book) return null;
    const sources = [book.coverUrl, book.horizThumbUrl]
      .filter((source, index, values) => Boolean(source) && values.indexOf(source) === index);
    try {
      for (const source of sources) {
        try {
          const dataUrl = await this.coverImages.getDataUrl(source);
          const cover = parseCoverDataUrl(dataUrl);
          if (cover) return cover;
        } catch {
          // A missing cover must never prevent a completed book from being exported.
        }
      }
      return null;
    } finally {
      this.coverImages.clear?.();
    }
  }

  exportBook(bookId, format = 'txt', options = {}) {
    const book = this.repository.getBook(bookId);
    if (!book) throw new Error('未找到可导出的书籍缓存');
    const chapters = this.repository.listChapters(bookId, { withContentOnly: true });
    if (chapters.length === 0) throw new Error('没有可导出的已下载章节');
    const normalizedFormat = String(format).toLowerCase();
    if (!['txt', 'epub'].includes(normalizedFormat)) throw new Error('仅支持 TXT 或 EPUB');
    const basename = sanitizeFilename(
      [book.bookName || book.bookId, book.author].filter(Boolean).join(' - ')
    );
    const target = path.join(this.exportsDir, `${basename}.${normalizedFormat}`);
    const temporary = `${target}.tmp-${randomUUID()}`;
    const data = normalizedFormat === 'txt'
      ? createTxt(book, chapters)
      : createEpub(book, chapters, options.cover || null);
    writeFileSync(temporary, data);
    rmSync(target, { force: true });
    renameSync(temporary, target);
    return {
      bookId: book.bookId,
      format: normalizedFormat,
      chapters: chapters.length,
      path: target
    };
  }
}

function createTxt(book, chapters) {
  const sections = [
    book.bookName,
    `作者：${book.author || '未知作者'}`,
    '',
    book.description || '',
    ''
  ];
  for (const chapter of chapters) {
    sections.push(formatTxtBody(chapter.txtContent), '');
  }
  return `\uFEFF${sections.join('\r\n')}`;
}

function formatTxtBody(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => {
      const paragraph = line.trim();
      return paragraph ? `　　${paragraph}` : '';
    })
    .join('\r\n');
}

function createEpub(book, chapters, cover) {
  const publication = {
    ...book,
    bookName: String(book.bookName || book.bookId || '未命名书籍'),
    author: String(book.author || '未知作者')
  };
  const identifier = `urn:fqnovel:${encodeURIComponent(String(book.bookId))}`;
  const chapterEntries = chapters.map((chapter, index) => {
    const number = String(index + 1).padStart(5, '0');
    return {
      ...chapter,
      id: `chapter-${index + 1}`,
      title: String(chapter.title || `第 ${index + 1} 章`),
      filename: `${EPUB_ROOT}/text/chapter-${number}.xhtml`,
      href: `text/chapter-${number}.xhtml`
    };
  });
  const entries = [
    { name: 'mimetype', data: EPUB_MIMETYPE, store: true },
    {
      name: 'META-INF/container.xml',
      data: containerXml()
    },
    {
      name: EPUB_PACKAGE_PATH,
      data: contentOpf(publication, identifier, chapterEntries, cover)
    },
    {
      name: `${EPUB_ROOT}/nav.xhtml`,
      data: navigationXhtml(publication, chapterEntries, cover)
    },
    {
      name: `${EPUB_ROOT}/toc.ncx`,
      data: tocNcx(publication, identifier, chapterEntries)
    },
    {
      name: EPUB_STYLESHEET_PATH,
      data: bookStylesheet()
    },
    {
      name: `${EPUB_ROOT}/text/title.xhtml`,
      data: titlePageXhtml(publication)
    }
  ];
  if (cover) {
    entries.push(
      {
        name: `${EPUB_ROOT}/images/cover.${cover.extension}`,
        data: cover.data,
        store: true
      },
      {
        name: `${EPUB_ROOT}/text/cover.xhtml`,
        data: coverPageXhtml(publication, cover)
      }
    );
  }
  for (const chapter of chapterEntries) {
    entries.push({ name: chapter.filename, data: chapterXhtml(chapter) });
  }
  assertEpubStructure(entries, chapterEntries, cover);
  return createZip(entries);
}

function containerXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="${EPUB_PACKAGE_PATH}" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`;
}

function contentOpf(book, identifier, chapters, cover) {
  const manifest = chapters.map((chapter) =>
    `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`
  ).join('\n    ');
  const spine = chapters.map((chapter) => `<itemref idref="${chapter.id}"/>`).join('\n    ');
  const description = book.description
    ? `\n    <dc:description>${escapeXml(book.description)}</dc:description>`
    : '';
  const coverMetadata = cover
    ? '\n    <meta name="cover" content="cover-image"/>'
    : '';
  const coverManifest = cover
    ? `\n    <item id="cover-image" href="images/cover.${cover.extension}" media-type="${cover.mediaType}" properties="cover-image"/>\n    <item id="cover-page" href="text/cover.xhtml" media-type="application/xhtml+xml"/>`
    : '';
  const coverSpine = cover
    ? '\n    <itemref idref="cover-page"/>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0"
         unique-identifier="publication-id" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="publication-id">${escapeXml(identifier)}</dc:identifier>
    <dc:title id="title">${escapeXml(book.bookName)}</dc:title>
    <meta refines="#title" property="title-type">main</meta>
    <dc:creator id="creator">${escapeXml(book.author)}</dc:creator>
    <meta refines="#creator" property="role" scheme="marc:relators">aut</meta>
    <dc:language>zh-CN</dc:language>${description}${coverMetadata}
    <meta property="dcterms:modified">${epubModifiedTime()}</meta>
    <meta property="rendition:layout">reflowable</meta>
    <meta property="rendition:orientation">auto</meta>
    <meta property="rendition:spread">auto</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="stylesheet" href="styles/book.css" media-type="text/css"/>
    <item id="title-page" href="text/title.xhtml" media-type="application/xhtml+xml"/>${coverManifest}
    ${manifest}
  </manifest>
  <spine toc="ncx" page-progression-direction="ltr">${coverSpine}
    <itemref idref="title-page"/>
    ${spine}
  </spine>
</package>`;
}

function navigationXhtml(book, chapters, cover) {
  const items = chapters.map((chapter) =>
    `<li><a href="${chapter.href}">${escapeXml(chapter.title)}</a></li>`
  ).join('\n        ');
  const firstChapter = chapters[0]?.href || 'text/title.xhtml';
  const coverLandmark = cover
    ? '\n      <li><a epub:type="cover" href="text/cover.xhtml">&#23553;&#38754;</a></li>'
    : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>目录 - ${escapeXml(book.bookName)}</title>
  <link rel="stylesheet" type="text/css" href="styles/book.css"/>
</head>
<body epub:type="frontmatter">
  <nav epub:type="toc" id="toc" role="doc-toc">
    <h1>目录</h1>
    <ol>
        ${items}
    </ol>
  </nav>
  <nav epub:type="landmarks" hidden="hidden">
    <h2>导览</h2>
    <ol>
      ${coverLandmark}
      <li><a epub:type="titlepage" href="text/title.xhtml">书名页</a></li>
      <li><a epub:type="bodymatter" href="${firstChapter}">正文</a></li>
    </ol>
  </nav>
</body>
</html>`;
}

function tocNcx(book, identifier, chapters) {
  const points = chapters.map((chapter, index) =>
    `    <navPoint id="${chapter.id}" playOrder="${index + 1}">
      <navLabel><text>${escapeXml(chapter.title)}</text></navLabel>
      <content src="${chapter.href}"/>
    </navPoint>`
  ).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1" xml:lang="zh-CN">
  <head>
    <meta name="dtb:uid" content="${escapeXml(identifier)}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <docTitle><text>${escapeXml(book.bookName)}</text></docTitle>
  <navMap>
${points}
  </navMap>
</ncx>`;
}

function titlePageXhtml(book) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(book.bookName)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="frontmatter">
  <section epub:type="titlepage" class="title-page">
    <h1>${escapeXml(book.bookName)}</h1>
    <p class="author">${escapeXml(book.author)}</p>
  </section>
</body>
</html>`;
}

function coverPageXhtml(book, cover) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>Cover - ${escapeXml(book.bookName)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="frontmatter" class="cover-page">
  <section epub:type="cover">
    <img src="../images/cover.${cover.extension}" alt="${escapeXml(book.bookName)}"/>
  </section>
</body>
</html>`;
}

function chapterXhtml(chapter) {
  const paragraphs = String(chapter.txtContent || '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => `      <p>${escapeXml(line.trim())}</p>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml"
      xmlns:epub="http://www.idpf.org/2007/ops"
      xml:lang="zh-CN" lang="zh-CN">
<head>
  <meta charset="UTF-8"/>
  <title>${escapeXml(chapter.title)}</title>
  <link rel="stylesheet" type="text/css" href="../styles/book.css"/>
</head>
<body epub:type="bodymatter">
  <section epub:type="chapter" class="chapter" aria-label="${escapeXml(chapter.title)}">
${paragraphs}
  </section>
</body>
</html>`;
}

function bookStylesheet() {
  return `@charset "UTF-8";

html {
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  padding: 0;
  font-family: serif;
  font-size: 1em;
  line-height: 1.8;
}

.chapter {
  margin: 0;
  padding: 0;
}

.chapter p {
  margin: 0 0 0.75em;
  padding: 0;
  text-indent: 2em;
  text-align: justify;
  text-justify: inter-ideograph;
  orphans: 2;
  widows: 2;
}

.chapter p:last-child {
  margin-bottom: 0;
}

.title-page {
  margin: 20vh 8% 0;
  text-align: center;
}

.title-page h1 {
  margin: 0 0 2em;
  font-size: 1.8em;
  line-height: 1.5;
}

.title-page .author {
  margin: 0;
  text-indent: 0;
}

.cover-page {
  margin: 0;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  text-align: center;
}

.cover-page section {
  margin: 0;
  padding: 0;
}

.cover-page img {
  max-width: 100%;
  max-height: 100vh;
}

nav {
  margin: 0;
  padding: 0;
}

nav h1 {
  margin: 0 0 1.25em;
  font-size: 1.6em;
}

nav ol {
  margin: 0;
  padding-left: 1.5em;
}

nav li {
  margin: 0 0 0.7em;
  line-height: 1.5;
}

nav a {
  color: inherit;
  text-decoration: none;
}
`;
}

function epubModifiedTime() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function assertEpubStructure(entries, chapters, cover) {
  if (entries[0]?.name !== 'mimetype'
      || entries[0]?.data !== EPUB_MIMETYPE
      || entries[0]?.store !== true) {
    throw new Error('EPUB mimetype 必须是首个且不压缩的文件');
  }
  const names = new Set();
  for (const entry of entries) {
    const name = String(entry.name || '');
    if (!name || name.includes('\\') || name.startsWith('/') || name.split('/').includes('..')) {
      throw new Error(`EPUB 包含无效路径：${name}`);
    }
    if (names.has(name)) throw new Error(`EPUB 包含重复文件：${name}`);
    names.add(name);
  }
  for (const required of [
    'mimetype',
    'META-INF/container.xml',
    EPUB_PACKAGE_PATH,
    `${EPUB_ROOT}/nav.xhtml`,
    EPUB_STYLESHEET_PATH,
    `${EPUB_ROOT}/text/title.xhtml`
  ]) {
    if (!names.has(required)) throw new Error(`EPUB 缺少必要文件：${required}`);
  }
  for (const chapter of chapters) {
    if (!names.has(chapter.filename)) throw new Error(`EPUB 缺少章节文件：${chapter.filename}`);
  }
  if (cover) {
    for (const required of [
      `${EPUB_ROOT}/images/cover.${cover.extension}`,
      `${EPUB_ROOT}/text/cover.xhtml`
    ]) {
      if (!names.has(required)) throw new Error(`EPUB is missing cover file: ${required}`);
    }
  }
}

function sanitizeFilename(value) {
  const cleaned = String(value || 'book').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').trim();
  return cleaned.slice(0, 120) || 'book';
}
function parseCoverDataUrl(value) {

  const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(
    String(value || '')
  );
  if (!match) return null;
  const mediaType = match[1].toLowerCase();
  const extensions = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp'
  };
  const data = Buffer.from(match[2], 'base64');
  if (data.length === 0) return null;
  return { data, mediaType, extension: extensions[mediaType] };
}

function escapeXml(value) {
  return validXmlText(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function validXmlText(value) {
  return Array.from(String(value ?? ''))
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint === 0x09
        || codePoint === 0x0a
        || codePoint === 0x0d
        || (codePoint >= 0x20 && codePoint <= 0xd7ff)
        || (codePoint >= 0xe000 && codePoint <= 0xfffd)
        || (codePoint >= 0x10000 && codePoint <= 0x10ffff);
    })
    .join('');
}
