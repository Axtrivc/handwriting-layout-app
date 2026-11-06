"""BoundedExecutor admission, timeout, cancellation and error contracts."""
from __future__ import annotations

import asyncio
import sys
import threading
import time
from pathlib import Path

import pytest

_API_DIR = Path(__file__).resolve().parents[1]
for _path in (str(_API_DIR), str(_API_DIR.parent / "vision")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

from app.workloads import BoundedExecutor, WorkloadError  # noqa: E402
from vision.native import configure_opencv_threads  # noqa: E402


def _executor(**overrides) -> BoundedExecutor:
    options = dict(max_workers=1, max_queue=1, queue_timeout=0.1, process_timeout=0.2)
    options.update(overrides)
    return BoundedExecutor("test", **options)


def test_worker_limit_is_enforced():
    async def scenario():
        pool = _executor(max_workers=2, max_queue=4)
        lock = threading.Lock()
        active = 0
        maximum = 0

        def work():
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
            time.sleep(0.02)
            with lock:
                active -= 1
            return True

        try:
            assert await asyncio.gather(*(pool.run(work) for _ in range(6))) == [True] * 6
            assert maximum == 2
            assert pool.active_count == 0
            assert pool.queued_count == 0
        finally:
            pool.shutdown()

    asyncio.run(scenario())


def test_queue_full_is_stable_and_recovers():
    async def scenario():
        pool = _executor()
        release = threading.Event()
        started = threading.Event()

        def block():
            started.set()
            release.wait(0.5)

        try:
            first = asyncio.create_task(pool.run(block))
            await asyncio.to_thread(started.wait, 0.2)
            second = asyncio.create_task(pool.run(lambda: None))
            await asyncio.sleep(0.01)
            with pytest.raises(WorkloadError) as error:
                await pool.run(lambda: None)
            assert error.value.status_code == 429
            assert error.value.code == "queue_full"
            assert error.value.headers == {"Retry-After": "1"}
            release.set()
            await asyncio.gather(first, second)
            assert pool.active_count == 0
            assert pool.queued_count == 0
        finally:
            release.set()
            pool.shutdown()

    asyncio.run(scenario())


def test_queue_timeout_removes_waiter():
    async def scenario():
        pool = _executor(queue_timeout=0.005)
        release = threading.Event()
        started = threading.Event()

        def block():
            started.set()
            release.wait(0.5)

        try:
            first = asyncio.create_task(pool.run(block))
            await asyncio.to_thread(started.wait, 0.2)
            with pytest.raises(WorkloadError) as error:
                await pool.run(lambda: None)
            assert error.value.status_code == 503
            assert error.value.code == "queue_timeout"
            assert pool.queued_count == 0
            release.set()
            await first
        finally:
            release.set()
            pool.shutdown()

    asyncio.run(scenario())


def test_processing_timeout_releases_slot_when_sync_work_finishes():
    async def scenario():
        pool = _executor(process_timeout=0.005)
        with pytest.raises(WorkloadError) as error:
            await pool.run(lambda: time.sleep(0.03))
        assert error.value.status_code == 504
        assert error.value.code == "processing_timeout"
        assert pool.active_count == 1, "running native work is never falsely reported as stopped"
        for _ in range(20):
            if pool.active_count == 0:
                break
            await asyncio.sleep(0.005)
        assert pool.active_count == 0
        assert await pool.run(lambda: "ok") == "ok"
        pool.shutdown()

    asyncio.run(scenario())


def test_cancelled_waiter_does_not_consume_a_later_slot():
    async def scenario():
        pool = _executor()
        release = threading.Event()
        started = threading.Event()

        def block():
            started.set()
            release.wait(0.5)

        try:
            first = asyncio.create_task(pool.run(block))
            await asyncio.to_thread(started.wait, 0.2)
            waiting = asyncio.create_task(pool.run(lambda: None))
            await asyncio.sleep(0.01)
            waiting.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiting
            assert pool.queued_count == 0
            release.set()
            await first
            assert await pool.run(lambda: "ok") == "ok"
        finally:
            release.set()
            pool.shutdown()

    asyncio.run(scenario())


def test_memory_and_internal_errors_are_client_safe():
    async def scenario():
        pool = _executor()

        def memory_error():
            raise MemoryError("secret allocation details")

        def internal_error():
            raise RuntimeError("secret internal details")

        try:
            with pytest.raises(WorkloadError) as memory:
                await pool.run(memory_error)
            assert memory.value.status_code == 503
            assert memory.value.code == "memory_exhausted"
            assert "secret" not in memory.value.detail
            with pytest.raises(WorkloadError) as internal:
                await pool.run(internal_error)
            assert internal.value.status_code == 500
            assert internal.value.code == "processing_failed"
            assert "secret" not in internal.value.detail
        finally:
            pool.shutdown()

    asyncio.run(scenario())


def test_shutdown_rejects_new_work():
    async def scenario():
        pool = _executor()
        pool.shutdown()
        with pytest.raises(WorkloadError) as error:
            await pool.run(lambda: None)
        assert error.value.status_code == 503
        assert error.value.code == "workload_unavailable"

    asyncio.run(scenario())


def test_opencv_thread_limit(monkeypatch):
    calls = []
    monkeypatch.setattr("vision.native.cv2.setNumThreads", calls.append)
    configure_opencv_threads(1)
    configure_opencv_threads(4)
    assert calls == [1, 4]
    with pytest.raises(ValueError):
        configure_opencv_threads(0)
