"""Native-library runtime limits shared by all vision workloads."""
from __future__ import annotations

import cv2


def configure_opencv_threads(thread_count: int) -> None:
    """Limit OpenCV's process-wide worker pool.

    Application-level concurrency cannot prevent each OpenCV call from creating
    its own large native thread team. Keep this separate from request admission
    so embedders and tests can apply the same limit without running the API.
    """
    if not 1 <= thread_count <= 64:
        raise ValueError("OpenCV thread count must be between 1 and 64")
    cv2.setNumThreads(thread_count)
