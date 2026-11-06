"""Bounded application-level execution for CPU- and memory-heavy routes.

The public route functions are async wrappers, while the actual synchronous
vision/OCR work runs here instead of Starlette's unbounded-for-this-purpose
request thread pool. At most ``max_workers`` calls and ``max_queue`` additional
waiters exist per executor. A processing timeout stops the HTTP wait only: it
cannot and does not forcibly terminate synchronous OpenCV or OCR code. The
worker slot is released by the concurrent future's done callback, including
when an unsubmitted future is cancelled or a running call finishes after its
client has gone away.

Environment variables (configured in :mod:`app.config`):

- ``HW_VISION_MAX_WORKERS`` / ``HW_OCR_MAX_WORKERS``: concurrent calls.
- ``HW_VISION_MAX_QUEUE`` / ``HW_OCR_MAX_QUEUE``: waiting calls, excluding
  running calls; zero disables queueing.
- ``HW_VISION_QUEUE_TIMEOUT_SECONDS`` / ``HW_OCR_QUEUE_TIMEOUT_SECONDS``:
  maximum time spent waiting for a worker slot.
- ``HW_VISION_PROCESS_TIMEOUT_SECONDS`` /
  ``HW_OCR_PROCESS_TIMEOUT_SECONDS``: maximum HTTP wait after starting work.
- ``HW_OPENCV_NUM_THREADS``: OpenCV's process-wide native thread limit.

All limits are per Python process. Multiple Uvicorn workers or packaged API
processes each have independent queues, worker pools, models and native
threads.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import threading
from collections import deque
from concurrent.futures import Future as ConcurrentFuture
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

from fastapi import HTTPException

_VISION_PARENT = Path(__file__).resolve().parents[2] / "vision"
if str(_VISION_PARENT) not in sys.path:
    sys.path.insert(0, str(_VISION_PARENT))

from vision.encoding import ImageLimitError  # noqa: E402
from vision.native import configure_opencv_threads  # noqa: E402

from .config import (  # noqa: E402
    OPENCV_NUM_THREADS,
    OCR_MAX_QUEUE,
    OCR_MAX_WORKERS,
    OCR_PROCESS_TIMEOUT_SECONDS,
    OCR_QUEUE_TIMEOUT_SECONDS,
    VISION_MAX_QUEUE,
    VISION_MAX_WORKERS,
    VISION_PROCESS_TIMEOUT_SECONDS,
    VISION_QUEUE_TIMEOUT_SECONDS,
)

logger = logging.getLogger(__name__)
_T = TypeVar("_T")

MEMORY_ERROR_CODE = "memory_exhausted"
MEMORY_ERROR_DETAIL = "可用内存不足，请缩小图片或稍后重试"


class WorkloadError(Exception):
    """A stable, client-safe workload failure."""

    def __init__(
        self,
        status_code: int,
        code: str,
        detail: str,
        *,
        retry_after: int | None = None,
    ) -> None:
        super().__init__(detail)
        self.status_code = status_code
        self.code = code
        self.detail = detail
        self.headers = {"Retry-After": str(retry_after)} if retry_after is not None else None


def memory_workload_error() -> WorkloadError:
    return WorkloadError(503, MEMORY_ERROR_CODE, MEMORY_ERROR_DETAIL, retry_after=1)


@dataclass(eq=False)
class _Waiter:
    loop: asyncio.AbstractEventLoop
    future: asyncio.Future[None]
    state: str = "queued"  # queued | ready | cancelled


class BoundedExecutor:
    """FIFO admission in front of a small synchronous worker pool.

    State counters are protected by a threading lock rather than an asyncio
    lock, so a pool remains safe when offline ASGI tests use separate event
    loops sequentially. Cancellation of a queued coroutine removes its waiter;
    cancellation of submitted work uses ``Future.cancel`` and therefore only
    succeeds if execution has not started.
    """

    def __init__(
        self,
        name: str,
        *,
        max_workers: int,
        max_queue: int,
        queue_timeout: float,
        process_timeout: float,
    ) -> None:
        if max_workers < 1:
            raise ValueError("max_workers must be at least 1")
        if max_queue < 0:
            raise ValueError("max_queue cannot be negative")
        if queue_timeout < 0:
            raise ValueError("queue_timeout cannot be negative")
        if process_timeout <= 0:
            raise ValueError("process_timeout must be positive")
        self.name = name
        self.max_workers = max_workers
        self.max_queue = max_queue
        self.queue_timeout = queue_timeout
        self.process_timeout = process_timeout
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers,
            thread_name_prefix=f"hw-{name}",
        )
        self._lock = threading.Lock()
        self._waiters: deque[_Waiter] = deque()
        self._active = 0
        self._closed = False

    @property
    def active_count(self) -> int:
        with self._lock:
            return self._active

    @property
    def queued_count(self) -> int:
        with self._lock:
            return sum(waiter.state == "queued" for waiter in self._waiters)

    async def run(self, fn: Callable[..., _T], *args: Any) -> _T:
        waiter = self._acquire_or_enqueue()
        if waiter is not None:
            await self._wait_for_slot(waiter)

        try:
            concurrent_future = self._executor.submit(fn, *args)
        except BaseException:
            # The slot was reserved before submission and has no done callback
            # to release it if the executor itself rejects the work.
            self._release_slot()
            raise

        async_future = asyncio.wrap_future(concurrent_future)
        concurrent_future.add_done_callback(self._worker_done)
        # Once timeout/cancellation abandons the HTTP wait, explicitly retrieve
        # a later exception to avoid an unobserved asyncio Future warning.
        async_future.add_done_callback(_consume_exception)

        try:
            return await asyncio.wait_for(
                asyncio.shield(async_future),
                timeout=self.process_timeout,
            )
        except TimeoutError:
            # Effective only if a submitted future has not started. A running
            # synchronous call keeps its slot until its done callback fires.
            concurrent_future.cancel()
            raise WorkloadError(
                504,
                "processing_timeout",
                "图像处理超时，请缩小图片、减少区域或稍后重试",
            ) from None
        except asyncio.CancelledError:
            async_future.cancel()
            raise
        except MemoryError:
            logger.warning("%s workload exhausted available memory", self.name)
            raise memory_workload_error() from None
        except (HTTPException, ImageLimitError, WorkloadError):
            raise
        except Exception:
            logger.exception("%s workload failed", self.name)
            raise WorkloadError(
                500,
                "processing_failed",
                "图像处理失败，请检查输入或稍后重试",
            ) from None

    def shutdown(self, *, wait: bool = True) -> None:
        """Reject new work and cancel waiters; primarily for offline tests."""
        with self._lock:
            if self._closed:
                return
            self._closed = True
            waiters = list(self._waiters)
            self._waiters.clear()
            for waiter in waiters:
                waiter.state = "cancelled"
        for waiter in waiters:
            _notify_threadsafe(waiter, cancel=True)
        self._executor.shutdown(wait=wait, cancel_futures=True)

    def _acquire_or_enqueue(self) -> _Waiter | None:
        loop = asyncio.get_running_loop()
        with self._lock:
            if self._closed:
                raise WorkloadError(503, "workload_unavailable", "图像处理服务正在关闭")
            if not self._waiters and self._active < self.max_workers:
                self._active += 1
                return None
            if len(self._waiters) >= self.max_queue:
                raise WorkloadError(
                    429,
                    "queue_full",
                    "图像处理队列已满，请稍后重试",
                    retry_after=1,
                )
            waiter = _Waiter(loop=loop, future=loop.create_future())
            self._waiters.append(waiter)
            return waiter

    async def _wait_for_slot(self, waiter: _Waiter) -> None:
        try:
            await asyncio.wait_for(waiter.future, timeout=self.queue_timeout)
        except TimeoutError:
            self._cancel_waiter(waiter)
            raise WorkloadError(
                503,
                "queue_timeout",
                "等待图像处理资源超时，请稍后重试",
                retry_after=1,
            ) from None
        except asyncio.CancelledError:
            self._cancel_waiter(waiter)
            raise

    def _cancel_waiter(self, waiter: _Waiter) -> None:
        with self._lock:
            if waiter.state == "queued":
                waiter.state = "cancelled"
                try:
                    self._waiters.remove(waiter)
                except ValueError:
                    pass
                return
            if waiter.state == "ready":
                # The release callback reserved a slot and notified us, but the
                # coroutine was cancelled before it could submit its work.
                waiter.state = "cancelled"
                self._release_slot_locked()

    def _worker_done(self, _future: ConcurrentFuture[Any]) -> None:
        self._release_slot()

    def _release_slot(self) -> None:
        with self._lock:
            self._release_slot_locked()

    def _release_slot_locked(self) -> None:
        if self._active <= 0:
            logger.error("%s workload slot accounting underflow", self.name)
            return
        self._active -= 1
        if self._closed:
            return
        while self._active < self.max_workers and self._waiters:
            waiter = self._waiters.popleft()
            if waiter.state != "queued":
                continue
            if waiter.future.cancelled():
                waiter.state = "cancelled"
                continue
            waiter.state = "ready"
            self._active += 1
            if not _notify_threadsafe(waiter):
                waiter.state = "cancelled"
                self._active -= 1


def _notify_threadsafe(waiter: _Waiter, *, cancel: bool = False) -> bool:
    def notify() -> None:
        if waiter.future.done():
            return
        if cancel:
            waiter.future.cancel()
        else:
            waiter.future.set_result(None)

    try:
        waiter.loop.call_soon_threadsafe(notify)
    except RuntimeError:
        # An abandoned offline ASGI loop may already be closed.
        return False
    return True


def _consume_exception(future: asyncio.Future[Any]) -> None:
    if future.cancelled():
        return
    try:
        future.exception()
    except (asyncio.CancelledError, MemoryError):
        # Retrieval is the purpose of this callback; normal awaiting still
        # receives the original result or exception from the same Future.
        pass


configure_opencv_threads(OPENCV_NUM_THREADS)

VISION_EXECUTOR = BoundedExecutor(
    "vision",
    max_workers=VISION_MAX_WORKERS,
    max_queue=VISION_MAX_QUEUE,
    queue_timeout=VISION_QUEUE_TIMEOUT_SECONDS,
    process_timeout=VISION_PROCESS_TIMEOUT_SECONDS,
)
OCR_EXECUTOR = BoundedExecutor(
    "ocr",
    max_workers=OCR_MAX_WORKERS,
    max_queue=OCR_MAX_QUEUE,
    queue_timeout=OCR_QUEUE_TIMEOUT_SECONDS,
    process_timeout=OCR_PROCESS_TIMEOUT_SECONDS,
)


async def run_vision(fn: Callable[..., _T], *args: Any) -> _T:
    return await VISION_EXECUTOR.run(fn, *args)


async def run_ocr(fn: Callable[..., _T], *args: Any) -> _T:
    return await OCR_EXECUTOR.run(fn, *args)
