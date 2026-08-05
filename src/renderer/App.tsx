import {
  Badge,
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  FluentProvider,
  Input,
  ProgressBar,
  Spinner,
  Text,
  webDarkTheme,
  webLightTheme
} from '@fluentui/react-components';
import {
  ArrowDownload24Regular,
  ArrowLeft24Regular,
  ArrowRight24Regular,
  Book24Filled,
  BookOpen24Regular,
  CheckmarkCircle20Filled,
  Dismiss24Regular,
  DocumentText24Regular,
  FolderOpen24Regular,
  Pause24Regular,
  Play24Regular,
  Search24Regular,
  Settings24Regular
} from '@fluentui/react-icons';
import { type FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type {
  AppSettings,
  Book,
  DownloadTask,
  ExportFormat,
  RuntimeStatus,
  SearchResponse,
  ViewId
} from './types';

const navigation: Array<{ id: ViewId; label: string; icon: ReactNode }> = [
  { id: 'search', label: '搜索', icon: <Search24Regular /> },
  { id: 'downloads', label: '下载任务', icon: <ArrowDownload24Regular /> },
  { id: 'settings', label: '设置', icon: <Settings24Regular /> }
];

const viewTitles: Record<ViewId, { title: string; description: string }> = {
  search: { title: '搜索小说', description: '找到书籍后直接下载为 TXT 或 EPUB' },
  downloads: { title: '下载任务', description: '查看全书下载、生成文件和失败重试进度' },
  settings: { title: '设置', description: '管理下载文件的保存位置' }
};

type NoticeIntent = 'success' | 'error' | 'info';

interface AppNotice {
  id: number;
  message: string;
  intent: NoticeIntent;
}

export function App() {
  const [activeView, setActiveView] = useState<ViewId>('search');
  const [status, setStatus] = useState<RuntimeStatus>({});
  const [settings, setSettings] = useState<AppSettings>({});
  const [darkMode, setDarkMode] = useState(
    () => window.matchMedia('(prefers-color-scheme: dark)').matches
  );
  const [notice, setNotice] = useState<AppNotice | null>(null);
  const noticeId = useRef(0);
  const noticeTimer = useRef<number | null>(null);

  const notify = useCallback((message: string, intent: NoticeIntent = 'info') => {
    const id = ++noticeId.current;
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice({ id, message, intent });
    noticeTimer.current = window.setTimeout(() => {
      setNotice((current) => current?.id === id ? null : current);
      noticeTimer.current = null;
    }, 2600);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handleTheme = (event: MediaQueryListEvent) => setDarkMode(event.matches);
    media.addEventListener('change', handleTheme);
    return () => media.removeEventListener('change', handleTheme);
  }, []);

  useEffect(() => {
    let mounted = true;
    Promise.all([window.fqnovel.getStatus(), window.fqnovel.getSettings()])
      .then(([nextStatus, nextSettings]) => {
        if (!mounted) return;
        setStatus(nextStatus);
        setSettings(nextSettings);
      })
      .catch((error) => notify(errorMessage(error, '运行状态加载失败'), 'error'));
    const unsubscribe = window.fqnovel.onStatus((nextStatus) => {
      setStatus(nextStatus);
      if (nextStatus.settings) {
        setSettings((current) => ({ ...current, ...nextStatus.settings }));
      }
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [notify]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!event.metaKey) return;
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setActiveView('search');
        window.dispatchEvent(new Event('fqnovel:focus-search'));
      }
      if (event.key === ',') {
        event.preventDefault();
        void chooseExportDirectory();
      }
    };
    window.addEventListener('keydown', handleShortcut);
    return () => window.removeEventListener('keydown', handleShortcut);
  }, []);

  const tasks = status.downloads?.tasks || [];

  async function chooseExportDirectory() {
    try {
      const nextSettings = await window.fqnovel.chooseExportDirectory();
      setSettings(nextSettings);
      notify('默认导出目录已更新', 'success');
    } catch (error) {
      notify(errorMessage(error, '导出目录设置失败'), 'error');
    }
  }

  return (
    <FluentProvider theme={darkMode ? webDarkTheme : webLightTheme} className="app-provider">
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <div className="brand-icon"><Book24Filled /></div>
            <div className="brand-copy">
              <strong>FQNovel</strong>
              <span>桌面客户端</span>
            </div>
          </div>

          <nav className="navigation" aria-label="主要功能">
            {navigation.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`nav-button ${activeView === item.id ? 'active' : ''}`}
                aria-current={activeView === item.id ? 'page' : undefined}
                onClick={() => setActiveView(item.id)}
              >
                {item.icon}
                <span>{item.label}</span>
                {item.id === 'downloads' && tasks.length > 0 && (
                  <span className="nav-count">{tasks.length}</span>
                )}
              </button>
            ))}
          </nav>

        </aside>

        <section className="workspace">
          <header className="topbar">
            <div>
              <Text as="h1" size={500} weight="semibold">{viewTitles[activeView].title}</Text>
              <Text className="view-description" size={200}>
                {viewTitles[activeView].description}
              </Text>
            </div>
            <Button
              icon={<FolderOpen24Regular />}
              onClick={() => void chooseExportDirectory()}
              title={settings.exportDirectory || '选择默认导出目录'}
            >
              导出目录
            </Button>
          </header>

          <main className="content">
            <div hidden={activeView !== 'search'}>
              <SearchView
                active={activeView === 'search'}
                onDownloadStarted={() => {
                  notify('全书下载任务已创建', 'success');
                  setActiveView('downloads');
                }}
                notify={notify}
              />
            </div>
            {activeView === 'downloads' && (
              <DownloadsView tasks={tasks} notify={notify} />
            )}
            {activeView === 'settings' && (
              <SettingsView
                settings={settings}
                onChooseDirectory={chooseExportDirectory}
              />
            )}
          </main>
        </section>
      </div>

      {notice && (
        <div
          key={notice.id}
          className={`app-notification ${notice.intent}`}
          role={notice.intent === 'error' ? 'alert' : 'status'}
          aria-live={notice.intent === 'error' ? 'assertive' : 'polite'}
        >
          <span className="app-notification-indicator" aria-hidden="true" />
          <span>{notice.message}</span>
        </div>
      )}
    </FluentProvider>
  );
}

interface NotifyProps {
  notify: (message: string, intent?: NoticeIntent) => void;
}

function SearchView({
  active,
  onDownloadStarted,
  notify
}: NotifyProps & { active: boolean; onDownloadStarted: () => void }) {
  const pageSize = 20;
  const [query, setQuery] = useState('');
  const [activeQuery, setActiveQuery] = useState('');
  const [response, setResponse] = useState<SearchResponse>({ books: [] });
  const [page, setPage] = useState(0);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selectedBook, setSelectedBook] = useState<Book | null>(null);
  const [format, setFormat] = useState<ExportFormat>('txt');
  const [creatingTask, setCreatingTask] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const focusSearch = () => searchInput.current?.focus();
    window.addEventListener('fqnovel:focus-search', focusSearch);
    return () => window.removeEventListener('fqnovel:focus-search', focusSearch);
  }, []);

  async function requestPage(nextPage: number, nextQuery = activeQuery, searchId = response.searchId) {
    if (!nextQuery) return;
    setSearching(true);
    setSearched(true);
    try {
      const nextResponse = await window.fqnovel.searchBooks({
        query: nextQuery,
        offset: nextPage * pageSize,
        count: pageSize,
        searchId: nextPage > 0 ? searchId : undefined
      });
      setResponse(nextResponse);
      setPage(nextPage);
    } catch (error) {
      setResponse({ books: [] });
      notify(errorMessage(error, '搜索失败'), 'error');
    } finally {
      setSearching(false);
    }
  }

  function handleSearch(event: FormEvent) {
    event.preventDefault();
    const value = query.trim();
    if (!value) return;
    setActiveQuery(value);
    setResponse({ books: [] });
    void requestPage(0, value, undefined);
  }

  async function createDownload() {
    if (!selectedBook) return;
    setCreatingTask(true);
    try {
      await window.fqnovel.createDownload(selectedBook.bookId, { format });
      setSelectedBook(null);
      onDownloadStarted();
    } catch (error) {
      notify(errorMessage(error, '创建下载任务失败'), 'error');
    } finally {
      setCreatingTask(false);
    }
  }

  const books = response.books || [];
  return (
    <div className="view-stack">
      <form className="command-surface search-command" onSubmit={handleSearch}>
        <Input
          ref={searchInput}
          size="large"
          value={query}
          contentBefore={<Search24Regular />}
          placeholder="输入书名或作者"
          onChange={(_event, data) => setQuery(data.value)}
          aria-label="搜索书名或作者"
        />
        <Button appearance="primary" size="large" type="submit" disabled={searching || !query.trim()}>
          {searching ? '搜索中…' : '搜索'}
        </Button>
      </form>

      <section className="list-surface" aria-label="搜索结果">
        <div className="list-header">
          <div>
            <Text as="h2" size={400} weight="semibold">搜索结果</Text>
            <Text size={200}>
              {searched ? `第 ${page + 1} 页 · 本页 ${books.length} 本` : '输入关键词开始搜索'}
            </Text>
          </div>
          {searched && !searching && (
            <div className="pagination-actions">
              <Button
                icon={<ArrowLeft24Regular />}
                disabled={page === 0}
                onClick={() => void requestPage(page - 1)}
              >
                上一页
              </Button>
              <Button
                icon={<ArrowRight24Regular />}
                iconPosition="after"
                disabled={!response.hasMore}
                onClick={() => void requestPage(page + 1)}
              >
                下一页
              </Button>
            </div>
          )}
        </div>

        {searching ? (
          <EmptyState icon={<Spinner />} title="正在搜索" description="正在从书源获取结果…" />
        ) : books.length > 0 ? (
          <div className="data-list search-result-list">
            {books.map((book) => (
              <div className="data-row search-result-row" key={book.bookId}>
                <BookCover book={book} enabled={active} />
                <div className="row-main search-book-main">
                  <div className="search-book-title">
                    <strong>{book.bookName || '未命名书籍'}</strong>
                    {Number(book.rating) > 0 && (
                      <Badge appearance="tint" color="brand">
                        {Number(book.rating).toFixed(1)} 分
                      </Badge>
                    )}
                  </div>
                  <span className="search-book-meta">{bookMeta(book).join(' · ')}</span>
                  {book.description && (
                    <p className="search-book-description">{compactText(book.description)}</p>
                  )}
                  <div className="search-book-footer">
                    {(book.tags || []).slice(0, 3).map((tag) => (
                      <Badge
                        key={tag}
                        className="search-book-tag"
                        appearance="outline"
                        title={tag}
                      >
                        {tag}
                      </Badge>
                    ))}
                    {book.lastChapterTitle && (
                      <span className="search-book-latest" title={book.lastChapterTitle}>
                        最新：{book.lastChapterTitle}
                      </span>
                    )}
                  </div>
                </div>
                <Button
                  appearance="primary"
                  icon={<ArrowDownload24Regular />}
                  onClick={() => {
                    setFormat('txt');
                    setSelectedBook(book);
                  }}
                >
                  下载全书
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Search24Regular />}
            title={searched ? '没有找到匹配书籍' : '搜索你的下一本书'}
            description={searched ? '请尝试更换书名或作者关键词' : '搜索结果会显示在这里'}
          />
        )}
      </section>

      <Dialog
        open={Boolean(selectedBook)}
        surfaceMotion={null}
        onOpenChange={(_event, data) => {
          if (!data.open && !creatingTask) setSelectedBook(null);
        }}
      >
        <DialogSurface className="download-dialog-surface" backdrop={null}>
          <DialogBody className="download-dialog-body">
            <DialogTitle>
              <div className="download-dialog-title">
                <span>下载全书</span>
                <strong title={selectedBook?.bookName || '未命名书籍'}>
                  《{selectedBook?.bookName || '未命名书籍'}》
                </strong>
              </div>
            </DialogTitle>
            <DialogContent>
              <div className="download-dialog-content">
                <div className="download-dialog-summary">
                  <span className="download-summary-icon"><ArrowDownload24Regular /></span>
                  <div>
                    <strong>下载全部章节</strong>
                    <span>完成后自动生成文件并保存到默认导出目录</span>
                  </div>
                </div>
                <div className="format-section">
                  <span className="format-options-label">选择文件格式</span>
                  <div className="format-options" role="radiogroup" aria-label="下载格式">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={format === 'txt'}
                      className={format === 'txt' ? 'active' : ''}
                      onClick={() => setFormat('txt')}
                    >
                      <span className="format-option-icon"><DocumentText24Regular /></span>
                      <span className="format-option-copy">
                        <strong>TXT</strong>
                        <span>兼容性最好，适合多数阅读器</span>
                      </span>
                      <span className="format-option-check" aria-hidden="true">
                        {format === 'txt' && <CheckmarkCircle20Filled />}
                      </span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={format === 'epub'}
                      className={format === 'epub' ? 'active' : ''}
                      onClick={() => setFormat('epub')}
                    >
                      <span className="format-option-icon"><BookOpen24Regular /></span>
                      <span className="format-option-copy">
                        <strong>EPUB</strong>
                        <span>保留章节目录和排版结构</span>
                      </span>
                      <span className="format-option-check" aria-hidden="true">
                        {format === 'epub' && <CheckmarkCircle20Filled />}
                      </span>
                    </button>
                  </div>
                </div>
              </div>
            </DialogContent>
            <DialogActions className="download-dialog-actions">
              <Button appearance="secondary" disabled={creatingTask} onClick={() => setSelectedBook(null)}>
                取消
              </Button>
              <Button
                appearance="primary"
                icon={<ArrowDownload24Regular />}
                disabled={creatingTask}
                onClick={() => void createDownload()}
              >
                {creatingTask ? '正在创建…' : `开始下载 ${format.toUpperCase()}`}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </div>
  );
}

function DownloadsView({ tasks, notify }: NotifyProps & { tasks: DownloadTask[] }) {
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  async function control(task: DownloadTask, action: 'pause' | 'resume' | 'cancel') {
    const key = `${task.id}:${action}`;
    setPendingAction(key);
    try {
      await window.fqnovel.controlDownload(task.id, action);
    } catch (error) {
      notify(errorMessage(error, '任务操作失败'), 'error');
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteTask(task: DownloadTask) {
    setPendingAction(`${task.id}:delete`);
    try {
      await window.fqnovel.deleteDownload(task.id);
      notify('任务记录已删除', 'success');
    } catch (error) {
      notify(errorMessage(error, '删除任务失败'), 'error');
    } finally {
      setPendingAction(null);
    }
  }

  async function showFile(task: DownloadTask) {
    if (!task.outputPath) return;
    try {
      await window.fqnovel.showFile(task.outputPath);
    } catch (error) {
      notify(errorMessage(error, '无法打开文件位置'), 'error');
    }
  }

  return (
    <section className="list-surface full-height">
      <div className="list-header">
        <div>
          <Text as="h2" size={400} weight="semibold">全部任务</Text>
          <Text size={200}>{tasks.length} 个下载记录</Text>
        </div>
      </div>

      {tasks.length > 0 ? (
        <div className="data-list">
          {tasks.map((task) => {
            const isActive = ['queued', 'running', 'exporting'].includes(task.status);
            const canResume = ['paused', 'failed'].includes(task.status);
            return (
              <div className="download-row" key={task.id}>
                <BookCover book={task} compact />
                <div className="download-main">
                  <div className="download-title">
                    <div className="download-book-copy">
                      <strong>{task.bookName || task.bookId}</strong>
                      <span>{task.author || '未知作者'}</span>
                    </div>
                    <span className="download-status">
                      {task.format.toUpperCase()} · {statusText(task.status)} ·{' '}
                      {task.completedChapters}/{task.totalChapters} 章
                    </span>
                  </div>
                  <ProgressBar
                    value={Math.max(0, Math.min(1, Number(task.progress || 0) / 100))}
                    thickness="medium"
                  />
                  {task.error && <span className="task-error">{task.error}</span>}
                </div>
                <strong className="progress-value">{task.progress || 0}%</strong>
                <div className="row-actions">
                  {task.status === 'running' && (
                    <Button
                      icon={<Pause24Regular />}
                      disabled={pendingAction === `${task.id}:pause`}
                      onClick={() => void control(task, 'pause')}
                    >
                      暂停
                    </Button>
                  )}
                  {canResume && (
                    <Button
                      appearance="primary"
                      icon={<Play24Regular />}
                      disabled={pendingAction === `${task.id}:resume`}
                      onClick={() => void control(task, 'resume')}
                    >
                      {task.status === 'failed' ? '重试' : '继续'}
                    </Button>
                  )}
                  {task.status === 'completed' && task.outputPath && (
                    <Button icon={<FolderOpen24Regular />} onClick={() => void showFile(task)}>
                      打开位置
                    </Button>
                  )}
                  {isActive && (
                    <Button
                      icon={<Dismiss24Regular />}
                      disabled={pendingAction === `${task.id}:cancel`}
                      onClick={() => void control(task, 'cancel')}
                    >
                      取消
                    </Button>
                  )}
                  {!isActive && (
                    <Button
                      appearance="subtle"
                      icon={<Dismiss24Regular />}
                      disabled={pendingAction === `${task.id}:delete`}
                      onClick={() => void deleteTask(task)}
                      aria-label="删除任务记录"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={<ArrowDownload24Regular />}
          title="还没有下载任务"
          description="在搜索结果中选择 TXT 或 EPUB，即可下载全书"
        />
      )}
    </section>
  );
}

function SettingsView({
  settings,
  onChooseDirectory
}: {
  settings: AppSettings;
  onChooseDirectory: () => Promise<void>;
}) {
  return (
    <section className="settings-surface" aria-label="下载设置">
      <div className="settings-heading">
        <div className="settings-icon"><FolderOpen24Regular /></div>
        <div>
          <Text as="h2" size={400} weight="semibold">下载位置</Text>
          <Text size={200}>TXT 和 EPUB 完成后保存在这里</Text>
        </div>
      </div>
      <code className="settings-path">{settings.exportDirectory || '正在读取默认目录…'}</code>
      <div className="settings-actions">
        <Button appearance="primary" icon={<FolderOpen24Regular />} onClick={() => void onChooseDirectory()}>
          选择下载目录
        </Button>
      </div>
    </section>
  );
}

function BookCover({
  book,
  compact = false,
  enabled = true
}: {
  book: Book;
  compact?: boolean;
  enabled?: boolean;
}) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setImageUrl(null);
    if (!enabled) return () => { cancelled = true; };
    const sources = [book.coverUrl, book.horizThumbUrl]
      .filter((source, index, values): source is string => (
        Boolean(source) && values.indexOf(source) === index
      ));

    void (async () => {
      for (const source of sources) {
        const nextImage = await window.fqnovel.getCoverImage(source);
        if (cancelled) return;
        if (nextImage) {
          setImageUrl(nextImage);
          return;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [book.coverUrl, book.horizThumbUrl, enabled]);

  return (
    <div className={`book-cover-frame${compact ? ' compact' : ''}`}>
      <BookAvatar title={book.bookName} />
      {imageUrl && (
        <img
          className="book-cover"
          src={imageUrl}
          alt={`《${book.bookName || '未命名书籍'}》封面`}
          onError={() => setImageUrl(null)}
        />
      )}
    </div>
  );
}

function BookAvatar({ title }: { title?: string }) {
  return <div className="book-avatar" aria-hidden="true">{(title || '书').trim().slice(0, 1)}</div>;
}

function EmptyState({ icon, title, description }: { icon: ReactNode; title: string; description: string }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">{icon}</div>
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}

function statusText(status: string) {
  return ({
    queued: '等待中',
    running: '下载中',
    paused: '已暂停',
    exporting: '正在生成文件',
    completed: '已完成',
    failed: '下载失败',
    cancelled: '已取消'
  } as Record<string, string>)[status] || status;
}

function bookMeta(book: Book) {
  const values = [
    book.author || '未知作者',
    book.category,
    book.wordCount ? formatWordCount(book.wordCount) : '',
    book.totalChapters ? `${book.totalChapters} 章` : '',
    book.statusText || book.completeCategory,
    book.readCntText
  ];
  return values.filter((value): value is string => Boolean(value));
}

function formatWordCount(value: number) {
  if (value >= 10_000) {
    const count = value / 10_000;
    return `${count >= 100 ? Math.round(count) : count.toFixed(1)} 万字`;
  }
  return `${value} 字`;
}

function compactText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message
      .replace(/^Error invoking remote method '[^']+':\s*/i, '')
      .replace(/^(?:FqApiError|DeviceRegistrationError|Error):\s*/i, '');
  }
  return fallback;
}
