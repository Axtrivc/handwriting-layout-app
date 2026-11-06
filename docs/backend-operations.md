# 本地后端运行与资源预算

## 请求与图片上限

- 请求体默认最多 272 MiB，同时校验 Content-Length 和实际读取字节数。
- 单张图片压缩数据最多 96 MiB，单边最多 16384 像素，总计最多 6400 万像素；像素在 EXIF 和完整栅格化前检查。
- 超限请求/图片返回 413；普通格式错误返回 400，Pydantic 参数错误返回 422。
- `normalizeSize <= 2048`，OCR regions/candidates 各最多 512。

## 有界执行器

FastAPI 路由只负责异步等待，OpenCV、Pillow 和 OCR 同步工作分别进入独立的有界执行器，不再无限占用默认请求线程池。默认每类一个工作进程内 worker、四个排队任务，OpenCV 原生线程数为一。

| 环境变量 | 默认值 | 含义 |
| --- | ---: | --- |
| `HW_VISION_MAX_WORKERS` | 1 | 扫描/清理/detect/glyph 并发数 |
| `HW_VISION_MAX_QUEUE` | 4 | 图像任务排队数（不含运行中） |
| `HW_VISION_QUEUE_TIMEOUT_SECONDS` | 5 | 等待 worker 的最长时间 |
| `HW_VISION_PROCESS_TIMEOUT_SECONDS` | 50 | 已提交任务的 HTTP 等待上限 |
| `HW_OCR_MAX_WORKERS` | 1 | OCR 并发数 |
| `HW_OCR_MAX_QUEUE` | 4 | OCR 排队数 |
| `HW_OCR_QUEUE_TIMEOUT_SECONDS` | 5 | OCR 排队等待上限 |
| `HW_OCR_PROCESS_TIMEOUT_SECONDS` | 50 | OCR HTTP 等待上限 |
| `HW_OPENCV_NUM_THREADS` | 1 | OpenCV 进程级原生线程数 |

这些限制按 Python 进程计算。多个 Uvicorn worker 会各自拥有队列、模型和线程预算。

错误 JSON 包含 `detail` 和稳定的 `code`：`queue_full`（429）、`queue_timeout`（503）、`processing_timeout`（504）、`memory_exhausted`（503）、`processing_failed`（500）。需要重试的错误带 `Retry-After`。

**处理超时不会强行终止已运行的同步 OpenCV/OCR。** 执行器会保留 worker slot 直到原生调用真正结束，避免后续任务继续叠加内存。需要硬杀任务时，应在操作系统中隔离独立工作进程，而不是把线程内取消误认为终止。

## 来源与桌面协议

CORS 只允许明确的 Vite 开发地址和 `hw-app://app`。生产 Electron 通过受限自定义协议读取打包的 `web-dist`，不再使用 `file://` 的 opaque `Origin: null`。协议处理器只允许访问该目录内资源，HTTP(S) 外链才允许交给系统浏览器。

## 桌面生命周期

桌面优先复用健康 API；未运行时启动打包的 `resources/backend/hw-api` 或开发 venv 中的 `launcher.py`，退出时只清理自己启动的进程。`HW_API_EXTERNAL=1` 禁止自动启动。打包 API 为 PyInstaller onedir，RapidOCR 仅在环境提供时收集，并在首次识别时懒加载。
