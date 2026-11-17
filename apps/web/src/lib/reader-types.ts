import type { ChapterImage, ContentQualityReport } from "@legado/shared";
import type { DisplayBlock } from "./reader-blocks";

export interface LoadedChapter {
  index: number;
  title: string;
  paragraphs: string[];
  starts: number[];
  /** 展示层分段；paragraphs/starts 仍是进度、标注、朗读的锚点层。 */
  blocks: DisplayBlock[];
  length: number;
  /** 正文插图，after = 前面有多少段正文（0 表示章首）。 */
  images: ChapterImage[];
  loading: boolean;
  error: string;
  /** 服务端正文质量报告；旧缓存没有这一项。 */
  quality?: ContentQualityReport | null;
}
