// 音频文件管理：录音先落在缓存目录，入桶时搬到 document/audio/ 持久保存。
import { File, Directory, Paths } from 'expo-file-system';

export function audioDir(): Directory {
  const dir = new Directory(Paths.document, 'audio');
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

/** 把录音产物移动到持久目录，返回最终 URI */
export function moveRecording(srcUri: string, ideaId: string): string {
  const src = new File(srcUri);
  const ext = srcUri.split('.').pop()?.split('?')[0] ?? 'm4a';
  const dest = new File(audioDir(), `${ideaId}.${ext}`);
  if (dest.exists) dest.delete();
  src.move(dest);
  return dest.uri;
}

export function deleteAudioFile(uri: string): void {
  try {
    if (!uri) return;
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // 文件可能已不存在，忽略
  }
}
