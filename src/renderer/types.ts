export type ViewId = 'search' | 'downloads' | 'settings';
export type ExportFormat = 'txt' | 'epub';

export interface Book {
  bookId: string;
  bookName?: string;
  author?: string;
  coverUrl?: string;
  horizThumbUrl?: string;
  description?: string;
  wordCount?: number;
  totalChapters?: number;
  category?: string;
  categoryV2?: string;
  completeCategory?: string;
  status?: string;
  statusText?: string;
  tomatoBookStatus?: string;
  tags?: string[];
  rating?: number;
  readCount?: string;
  readCntText?: string;
  lastChapterTitle?: string;
  lastChapterItemId?: string;
  creationStatus?: string;
  updateStatus?: string;
  updateTime?: number;
}

export interface SearchResponse {
  books?: Book[];
  total?: number;
  hasMore?: boolean;
  searchId?: string;
}

export interface DownloadTask {
  id: string;
  bookId: string;
  bookName?: string;
  author?: string;
  coverUrl?: string;
  horizThumbUrl?: string;
  format: ExportFormat;
  status: string;
  completedChapters: number;
  failedChapters?: number;
  totalChapters: number;
  progress?: number;
  outputPath?: string | null;
  error?: string | null;
  createdAt?: number;
  updatedAt?: number;
}

export interface AppSettings {
  exportDirectory?: string;
}

export interface RuntimeStatus {
  settings?: AppSettings;
  downloads?: {
    activeTasks?: number;
    tasks?: DownloadTask[];
  };
}

export interface FQNovelBridge {
  getStatus(): Promise<RuntimeStatus>;
  getCoverImage(url: string): Promise<string | null>;
  searchBooks(request: {
    query: string;
    offset: number;
    count: number;
    searchId?: string;
  }): Promise<SearchResponse>;
  createDownload(bookId: string, options: { format: ExportFormat }): Promise<DownloadTask>;
  controlDownload(taskId: string, action: 'pause' | 'resume' | 'cancel'): Promise<unknown>;
  deleteDownload(taskId: string): Promise<unknown>;
  getSettings(): Promise<AppSettings>;
  chooseExportDirectory(): Promise<AppSettings>;
  showFile(filePath: string): Promise<unknown>;
  onStatus(listener: (status: RuntimeStatus) => void): () => void;
}

declare global {
  interface Window {
    fqnovel: FQNovelBridge;
  }
}
