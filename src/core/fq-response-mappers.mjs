export function parseSearchResponse(payload, tabType = 3) {
  const tabs = Array.isArray(payload?.search_tabs) ? payload.search_tabs : [];
  const tab = tabs.find((item) => Number(item?.tab_type) === Number(tabType));
  if (!tab) return { books: [], total: 0, hasMore: false, searchId: '' };

  const books = [];
  for (const cell of Array.isArray(tab.data) ? tab.data : []) {
    for (const book of Array.isArray(cell?.book_data) ? cell.book_data : []) {
      books.push(mapSearchBook(book));
    }
  }
  return {
    books,
    total: numberValue(tab.total, books.length),
    hasMore: Boolean(tab.has_more),
    searchId: textValue(tab.search_id)
  };
}

export function normalizeDirectoryResponse(payload) {
  const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
  const items = Array.isArray(data.item_data_list) ? data.item_data_list : [];
  const itemDataList = items.map((item, index) => ({
    ...item,
    item_id: textValue(item.item_id),
    title: textValue(item.title),
    chapter_index: index + 1,
    sort_order: item.sort_order ?? index + 1,
    is_latest: index === items.length - 1,
    first_pass_time_str: formatUnixTime(item.first_pass_time)
  }));
  return {
    ...data,
    item_data_list: itemDataList,
    catalog_data: Array.isArray(data.catalog_data) ? data.catalog_data : [],
    serial_count: textValue(data.serial_count || data.book_info?.serial_count || itemDataList.length)
  };
}

export function mapBookInfo(directory, requestedBookId) {
  const book = directory?.book_info || {};
  const totalChapters = numberValue(
    book.serial_count ?? directory?.serial_count,
    Array.isArray(directory?.item_data_list) ? directory.item_data_list.length : 0
  );
  const tomatoBookStatus = textValue(book.tomato_book_status);
  const rawStatus = textValue(book.status) || tomatoBookStatus;
  const status = numberValue(rawStatus, 0);
  const creationStatus = textValue(book.creation_status);
  const updateStatus = textValue(book.update_status);
  const wordCount = numberValue(book.word_number, 0);
  const lastChapterUpdateTime = textValue(book.last_chapter_update_time);
  const category = textValue(book.category);
  const categoryV2 = textValue(book.category_v2);
  const completeCategory = textValue(book.complete_category);
  const genre = textValue(book.genre);
  const subGenre = textValue(book.sub_genre);
  const tags = normalizeTags(book.tags);
  const pureCategoryTags = normalizeTags(book.pure_category_tags);
  const rating = numberValue(book.score, 0);
  const readCntText = textValue(book.read_cnt_text);
  const statusText = bookStatusText(creationStatus, updateStatus, completeCategory);
  const description = textValue(book.abstract ?? book.abstract_content);
  const detailSummary = uniqueTextValues([
    statusText,
    rating > 0 ? `评分 ${formatRating(rating)}` : '',
    totalChapters > 0 ? `${totalChapters}章` : '',
    readCntText
  ]);
  const detailIntro = [detailSummary.join(' · '), description || textValue(book.book_abstract_v2)]
    .filter(Boolean).join('\n\n');
  const detailTags = uniqueTextValues([
    ...normalizeCategoryValues(category),
    ...normalizeCategoryV2(categoryV2),
    ...tags.flatMap(normalizeCategoryValues),
    ...pureCategoryTags.flatMap(normalizeCategoryValues),
  ]);
  return {
    bookId: textValue(book.book_id || requestedBookId),
    bookName: textValue(book.book_name),
    bookShortName: textValue(book.book_short_name),
    author: textValue(book.author),
    authorId: textValue(book.author_id),
    authorInfo: book.author_info || null,
    description,
    detailIntro,
    bookAbstractV2: textValue(book.book_abstract_v2),
    coverUrl: textValue(book.thumb_url),
    detailPageThumbUrl: textValue(book.detail_page_thumb_url),
    expandThumbUrl: textValue(book.expand_thumb_url),
    horizThumbUrl: textValue(book.horiz_thumb_url),
    status,
    tomatoBookStatus,
    statusText,
    creationStatus,
    updateStatus,
    updateStop: textValue(book.update_stop),
    wordNumber: wordCount,
    wordCount,
    totalChapters,
    firstChapterTitle: textValue(book.first_chapter_title),
    firstChapterItemId: textValue(book.first_chapter_item_id),
    firstChapterGroupId: textValue(book.first_chapter_group_id),
    lastChapterTitle: textValue(book.last_chapter_title),
    lastChapterItemId: textValue(book.last_chapter_item_id),
    lastChapterGroupId: textValue(book.last_chapter_group_id),
    lastChapterUpdateTime,
    lastChapterFirstPassTime: textValue(book.last_chapter_first_pass_time),
    updateTime: numberValue(book.last_chapter_update_time, 0),
    updateTimeText: formatUnixTime(book.last_chapter_update_time),
    category,
    categoryV2,
    categoryV2Ids: textValue(book.category_v2_ids),
    categorySchema: textValue(book.category_schema),
    completeCategory,
    pureCategoryTags,
    genre,
    genreType: textValue(book.genre_type),
    subGenre,
    tags,
    tagsStr: tags.join(','),
    detailTags,
    gender: textValue(book.gender),
    rating,
    readCount: textValue(book.read_count),
    readCountAll: textValue(book.read_count_all),
    readCntText,
    readDcnt30d: textValue(book.read_dcnt_30d),
    addBookshelfCount: textValue(book.add_bookshelf_count),
    allBookshelfCount: textValue(book.all_bookshelf_count),
    createTime: textValue(book.create_time),
    publishedDate: textValue(book.published_date),
    lastPublishTime: textValue(book.last_publish_time),
    firstOnlineTime: textValue(book.first_online_time),
    bookType: textValue(book.book_type),
    lengthType: textValue(book.length_type),
    isNew: textValue(book.is_new),
    isEbook: textValue(book.is_ebook),
    press: textValue(book.press),
    publisher: textValue(book.publisher),
    isbn: textValue(book.isbn),
    source: textValue(book.source),
    platform: textValue(book.platform)
  };
}

function mapSearchBook(book = {}) {
  const tags = normalizeTags(book.tags);
  const tomatoBookStatus = textValue(book.tomato_book_status);
  const status = textValue(book.status) || tomatoBookStatus;
  const creationStatus = textValue(book.creation_status);
  const updateStatus = textValue(book.update_status);
  const completeCategory = textValue(book.complete_category);
  const statusText = bookStatusText(creationStatus, updateStatus, completeCategory);
  const category = textValue(book.category);
  const totalChapters = numberValue(book.serial_count ?? book.content_chapter_number, 0);
  const rating = numberValue(book.score, 0);
  const readCntText = textValue(book.read_cnt_text);
  const searchTags = uniqueTextValues([
    ...normalizeCategoryValues(category),
    ...tags.flatMap(normalizeCategoryValues),
    statusText,
    rating > 0 ? `评分 ${formatRating(rating)}` : '',
    totalChapters > 0 ? `${totalChapters}章` : '',
    readCntText
  ]);
  return {
    bookId: textValue(book.book_id),
    bookName: textValue(book.book_name),
    bookShortName: textValue(book.book_short_name),
    author: textValue(book.author),
    authorId: textValue(book.author_id),
    authorInfo: book.author_info || null,
    description: textValue(book.abstract),
    bookAbstractV2: textValue(book.book_abstract_v2),
    coverUrl: textValue(book.thumb_url),
    detailPageThumbUrl: textValue(book.detail_page_thumb_url),
    expandThumbUrl: textValue(book.expand_thumb_url),
    horizThumbUrl: textValue(book.horiz_thumb_url),
    status,
    tomatoBookStatus,
    statusText,
    creationStatus,
    updateStatus,
    wordCount: numberValue(book.word_number, 0),
    totalChapters,
    firstChapterTitle: textValue(book.first_chapter_title),
    firstChapterItemId: textValue(book.first_chapter_item_id),
    lastChapterTitle: textValue(book.last_chapter_title),
    lastChapterItemId: textValue(book.last_chapter_item_id),
    updateTime: numberValue(book.last_chapter_update_time, 0),
    lastChapterUpdateTime: textValue(book.last_chapter_update_time),
    category,
    categoryV2: textValue(book.category_v2),
    completeCategory,
    genre: textValue(book.genre),
    subGenre: textValue(book.sub_genre),
    tags,
    tagsStr: tags.join(','),
    searchTags,
    gender: textValue(book.gender),
    rating,
    readCount: textValue(book.read_count),
    readCntText,
    addBookshelfCount: textValue(book.add_bookshelf_count),
    source: textValue(book.source),
    platform: textValue(book.platform)
  };
}

function normalizeTags(value) {
  if (Array.isArray(value)) return value.map(textValue).filter(Boolean);
  return textValue(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeCategoryValues(value) {
  const normalized = textValue(value).trim();
  if (!normalized || /^\d+$/.test(normalized) || normalizeBookStatusLabel(normalized)) return [];
  return normalized
    .split(/[\/|>＞、,，]+/)
    .map((item) => item.trim())
    .filter((item) => item && !/^\d+$/.test(item));
}

function normalizeCategoryV2(value) {
  if (Array.isArray(value)) return value.flatMap(categoryV2EntryValues);
  const raw = textValue(value).trim();
  if (!raw) return [];
  if (/^[\[{]/.test(raw)) {
    try {
      const parsed = JSON.parse(raw);
      return (Array.isArray(parsed) ? parsed : [parsed]).flatMap(categoryV2EntryValues);
    } catch {
      return [];
    }
  }
  return normalizeCategoryValues(raw);
}

function categoryV2EntryValues(value) {
  if (value && typeof value === 'object') {
    return normalizeCategoryValues(value.Name ?? value.name);
  }
  return normalizeCategoryValues(value);
}

function bookStatusText(creationStatus, updateStatus, completeCategory) {
  const values = [completeCategory, creationStatus, updateStatus]
    .map((value) => textValue(value).trim());
  const descriptiveStatus = values.map(normalizeBookStatusLabel).find(Boolean);
  if (descriptiveStatus) return descriptiveStatus;
  const lifecycleStatus = values.slice(1).find((value) => /^[01]$/.test(value));
  if (lifecycleStatus === '0') return '已完结';
  if (lifecycleStatus === '1') return '连载中';
  return '';
}

function normalizeBookStatusLabel(value) {
  if (/完结|完本/.test(value)) return '已完结';
  if (/连载|更新中|创作中/.test(value)) return '连载中';
  return '';
}

function uniqueTextValues(values) {
  const result = [];
  const seen = new Set();
  for (const value of values) {
    const normalized = textValue(value).trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

function formatRating(value) {
  const fixed = Number(value).toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

function textValue(value) {
  return value == null ? '' : String(value);
}

function numberValue(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function formatUnixTime(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
  const milliseconds = timestamp > 10_000_000_000 ? timestamp : timestamp * 1000;
  return new Date(milliseconds).toISOString().replace('T', ' ').slice(0, 19);
}
