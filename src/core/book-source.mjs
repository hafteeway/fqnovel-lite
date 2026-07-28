export function createBookSource(baseUrl) {
  return [{
    bookSourceComment: 'FQNovel Desktop 本地书源，支持完整书籍详情、目录和正文',
    bookSourceGroup: 'FQNovel',
    bookSourceName: 'FQNovel Desktop',
    bookSourceType: 0,
    bookSourceUrl: baseUrl,
    customOrder: 0,
    enabled: true,
    enabledCookieJar: false,
    enabledExplore: false,
    exploreUrl: '',
    header: JSON.stringify({
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0'
    }),
    respondTime: 180000,
    ruleBookInfo: {
      author: '$.data.author',
      canReName: 'true',
      coverUrl: '$.data.coverUrl||$.data.detailPageThumbUrl||$.data.expandThumbUrl',
      intro: '$.data.detailIntro||$.data.description||$.data.bookAbstractV2',
      kind: '$.data.detailTags[*]',
      lastChapter: '$.data.lastChapterTitle',
      name: '$.data.bookName',
      tocUrl: `${baseUrl}/api/fqsearch/directory/{{$.data.bookId}}
<js>
java.put("book_id", java.getString("$.data.bookId"));
result;
</js>`,
      updateTime: '$.data.updateTimeText||$.data.lastChapterUpdateTime',
      wordCount: '$.data.wordCount'
    },
    ruleContent: {
      content: '$.data.txtContent'
    },
    ruleSearch: {
      author: '$.author',
      bookList: '$.data.books[*]',
      bookUrl: `${baseUrl}/api/fqnovel/book/{{$.bookId}}`,
      coverUrl: '$.coverUrl||$.detailPageThumbUrl||$.expandThumbUrl',
      intro: '$.description||$.bookAbstractV2',
      kind: '$.searchTags[*]',
      lastChapter: '$.lastChapterTitle',
      name: `$.bookName
<js>
var searchId = java.getString("$..searchId");
if (searchId) java.put("search_id", searchId);
result;
</js>`,
      updateTime: '$.lastChapterUpdateTime',
      wordCount: '$.wordCount'
    },
    ruleToc: {
      chapterList: '$.data.item_data_list[*]',
      chapterName: '$.title',
      chapterUrl: '@js:source.bookSourceUrl + `/api/fqnovel/chapter/${java.get("book_id")}/${java.getString("$.item_id")}`'
    },
    searchUrl: `${baseUrl}/api/fqsearch/books?query={{key}}&offset={{(page-1)*20}}&count=20&tabType=3@js:
var searchId = java.get("search_id");
searchId ? result + "&searchId=" + encodeURIComponent(searchId) : result;`,
    weight: 0
  }];
}
