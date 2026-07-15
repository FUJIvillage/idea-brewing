export interface StreamLogBufferOptions {
  /** 改行なし断片をまとめて出すまでの無音時間(ms)。デフォルト 200 */
  idleMs?: number;
  /** 改行がなくてもこの文字数を超えたら分割して出す。デフォルト 160 */
  maxChars?: number;
}

export interface StreamLogBuffer {
  push(chunk: string): void;
  flush(): void;
}

/**
 * ストリーム断片を行単位(またはアイドル/上限)でまとめてから writeLine に渡す。
 * Cursor SDK の assistant text のように 1〜数文字ずつ来る断片を、読みやすいログ行にする。
 */
export function createStreamLogBuffer(
  writeLine: (line: string) => void,
  opts: StreamLogBufferOptions = {},
): StreamLogBuffer {
  const idleMs = opts.idleMs ?? 200;
  const maxChars = opts.maxChars ?? 160;
  let buffer = "";
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const clearIdle = () => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const emit = (line: string) => {
    if (line.trim()) writeLine(line);
  };

  const flushCompleteLines = () => {
    // \r\n / \n までを順に切り出す
    for (;;) {
      const match = /\r?\n/.exec(buffer);
      if (!match || match.index === undefined) break;
      const line = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      emit(line);
    }
    while (buffer.length >= maxChars) {
      emit(buffer.slice(0, maxChars));
      buffer = buffer.slice(maxChars);
    }
  };

  const scheduleIdle = () => {
    clearIdle();
    if (!buffer) return;
    idleTimer = setTimeout(() => {
      idleTimer = null;
      if (!buffer) return;
      emit(buffer);
      buffer = "";
    }, idleMs);
  };

  return {
    push(chunk: string) {
      if (!chunk) return;
      buffer += chunk;
      flushCompleteLines();
      scheduleIdle();
    },
    flush() {
      clearIdle();
      flushCompleteLines();
      if (buffer) {
        emit(buffer);
        buffer = "";
      }
    },
  };
}
