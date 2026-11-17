/** 逐帧解析 SSE 响应体：只取 event 名与单行 data，坏帧直接丢弃。
 *
 * 浏览器的 EventSource 不支持 POST、也不能带自定义头，换源/刷新这类长任务都用
 * fetch + ReadableStream 自己读；这个函数把「按 \n\n 切帧」的细节从页面里拿出来。
 */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: string, data: any) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let cut = buffer.indexOf("\n\n");
    while (cut >= 0) {
      const chunk = buffer.slice(0, cut);
      buffer = buffer.slice(cut + 2);
      cut = buffer.indexOf("\n\n");
      let event = "";
      let raw = "";
      for (const line of chunk.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) raw += line.slice(6);
      }
      if (!event || !raw) continue;
      try {
        onEvent(event, JSON.parse(raw));
      } catch {
        /* 坏帧直接丢弃 */
      }
    }
  }
}
