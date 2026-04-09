"use client";

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

interface VideoEntry {
  id: string;
  name: string;
  timestamp: number;
  url: string;
  uploadStatus: "pending" | "uploading" | "retrying" | "success" | "failed";
  retryCount: number;
}

const retryWithBackoff = async <T,>(
  fn: () => Promise<T>,
  maxRetries = 3,
  onRetry?: (attempt: number) => void
): Promise<T> => {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      if (i === maxRetries - 1) throw error;
      onRetry?.(i + 1);
      await new Promise((resolve) => setTimeout(resolve, 2 ** i * 1000));
    }
  }
  throw new Error("Max retries exceeded");
};

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("VideoDatabase", 1);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains("videos")) {
        db.createObjectStore("videos");
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const storeVideo = async (videoBlob: Blob, key: string): Promise<void> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("videos", "readwrite");
    const store = transaction.objectStore("videos");
    const request = store.put(videoBlob, key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
};

const retrieveAllVideos = async (): Promise<{ key: string; blob: Blob }[]> => {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("videos", "readonly");
    const store = transaction.objectStore("videos");
    const results: { key: string; blob: Blob }[] = [];
    const cursorRequest = store.openCursor();
    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        results.push({ key: String(cursor.key), blob: cursor.value });
        cursor.continue();
      } else {
        resolve(results);
      }
    };
    cursorRequest.onerror = () => reject(cursorRequest.error);
  });
};

export default function Home() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const [videoList, setVideoList] = useState<VideoEntry[]>([]);
  const [selectedVideoId, setSelectedVideoId] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  const startRecording = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.src = "";
        videoRef.current.srcObject = mediaStream;
      }

      const recorder = new MediaRecorder(mediaStream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = async () => {
        const videoBlob = new Blob(chunks, { type: "video/webm" });
        const timestamp = Date.now();
        const videoId = `video_${timestamp}_${crypto.randomUUID()}`;
        const url = URL.createObjectURL(videoBlob);

        try {
          await storeVideo(videoBlob, videoId);
          const newEntry: VideoEntry = {
            id: videoId,
            name: `Recording ${new Date(timestamp).toLocaleString()}`,
            timestamp,
            url,
            uploadStatus: "pending",
            retryCount: 0,
          };
          setVideoList((prev) => [...prev, newEntry]);
          setSelectedVideoId(videoId);
          if (videoRef.current) {
            videoRef.current.srcObject = null;
            videoRef.current.src = url;
          }
        } catch (error) {
          console.error("Error storing video:", error);
        }
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (error) {
      console.error("Error starting recording:", error);
    }
  };

  const stopRecording = () => {
    if (mediaRecorder) {
      mediaRecorder.stop();
      stream?.getTracks().forEach((track) => track.stop());
      setIsRecording(false);
    }
  };

  const simulateUploadForVideo = async (videoId: string) => {
    setVideoList((prev) =>
      prev.map((v) =>
        v.id === videoId ? { ...v, uploadStatus: "uploading" } : v
      )
    );
    try {
      await retryWithBackoff(
        async () => {
          const uploadSuccess = Math.random() > 0.5;
          if (!uploadSuccess) {
            throw new Error("Upload failed");
          }
        },
        3,
        (attempt) => {
          setVideoList((prev) =>
            prev.map((v) =>
              v.id === videoId
                ? { ...v, uploadStatus: "retrying", retryCount: attempt }
                : v
            )
          );
        }
      );
      setVideoList((prev) =>
        prev.map((v) =>
          v.id === videoId
            ? { ...v, uploadStatus: "success", retryCount: 0 }
            : v
        )
      );
    } catch (error) {
      setVideoList((prev) =>
        prev.map((v) =>
          v.id === videoId ? { ...v, uploadStatus: "failed" } : v
        )
      );
      console.error(`Upload failed after retries for video ${videoId}:`, error);
    }
  };

  const selectVideo = (video: VideoEntry) => {
    setSelectedVideoId(video.id);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.src = video.url;
    }
  };

  useEffect(() => {
    const loadVideos = async () => {
      try {
        const stored = await retrieveAllVideos();
        const entries: VideoEntry[] = stored.map(({ key, blob }) => {
          const parts = key.split("_");
          const timestamp =
            parts.length >= 2 ? parseInt(parts[1], 10) || Date.now() : Date.now();
          return {
            id: key,
            name: `Recording ${new Date(timestamp).toLocaleString()}`,
            timestamp,
            url: URL.createObjectURL(blob),
            uploadStatus: "pending",
            retryCount: 0,
          };
        });
        setVideoList(entries);
        if (entries.length > 0) {
          const last = entries[entries.length - 1];
          setSelectedVideoId(last.id);
          if (videoRef.current) {
            videoRef.current.src = last.url;
          }
        }
      } catch (error) {
        console.error("Error loading videos:", error);
      }
    };

    loadVideos();
  }, []);

  const selectedVideo = videoList.find((v) => v.id === selectedVideoId) ?? null;

  const statusColors: Record<VideoEntry["uploadStatus"], string> = {
    pending: "bg-zinc-200 text-zinc-700",
    uploading: "bg-blue-200 text-blue-700 animate-pulse",
    retrying: "bg-yellow-200 text-yellow-700 animate-pulse",
    success: "bg-green-200 text-green-700",
    failed: "bg-red-200 text-red-700",
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-start gap-8 py-16 px-8 bg-white dark:bg-black">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />

        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Video Recording with Local Backup
          </h1>
          <p className="text-lg text-zinc-600 dark:text-zinc-400">
            Record multiple videos, store them locally, and upload with automatic retry.
          </p>
        </div>

        {/* Video player */}
        <video
          ref={videoRef}
          className="w-full max-w-md rounded-lg bg-black"
          autoPlay
          playsInline
          controls={!!selectedVideo && !isRecording}
        />

        {/* Recording controls */}
        <div className="flex gap-4">
          {!isRecording ? (
            <button
              onClick={startRecording}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
            >
              Start Recording
            </button>
          ) : (
            <button
              onClick={stopRecording}
              className="flex h-12 items-center justify-center gap-2 rounded-full bg-red-600 px-5 text-white transition-colors hover:bg-red-700"
            >
              Stop Recording
            </button>
          )}
        </div>

        {/* Video list */}
        {videoList.length > 0 && (
          <div className="w-full">
            <h2 className="mb-3 text-xl font-semibold text-black dark:text-zinc-50">
              Stored Videos ({videoList.length})
            </h2>
            <ul className="flex flex-col gap-2">
              {videoList.map((video) => (
                <li
                  key={video.id}
                  className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-colors ${
                    selectedVideoId === video.id
                      ? "border-black dark:border-white bg-zinc-50 dark:bg-zinc-900"
                      : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50 dark:hover:bg-zinc-900"
                  }`}
                  onClick={() => selectVideo(video)}
                >
                  <div className="flex flex-col gap-1 min-w-0 mr-4">
                    <span className="text-sm font-medium text-black dark:text-zinc-50 truncate">
                      {video.name}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {video.id}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[video.uploadStatus]}`}
                    >
                      {video.uploadStatus}
                      {video.retryCount > 0 && ` (attempt ${video.retryCount})`}
                    </span>
                    {(video.uploadStatus === "pending" ||
                      video.uploadStatus === "failed") && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          simulateUploadForVideo(video.id);
                        }}
                        className="rounded-full border border-solid border-black/[.08] px-3 py-1 text-xs transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
                      >
                        {video.uploadStatus === "failed" ? "Retry Upload" : "Upload"}
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
