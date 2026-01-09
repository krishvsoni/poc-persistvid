"use client"; 

import { useState, useRef, useEffect } from "react";
import Image from "next/image";

export default function Home() {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
  const [recordedChunks, setRecordedChunks] = useState<Blob[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [isRecording, setIsRecording] = useState<boolean>(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const initDB = () => {
    return new Promise<IDBDatabase>((resolve, reject) => {
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

  const storeVideo = async (videoBlob: Blob) => {
    try {
      const db = await initDB();
      const transaction = db.transaction("videos", "readwrite");
      const store = transaction.objectStore("videos");
      store.put(videoBlob, "recordedVideo");
    } catch (error) {
      console.error("Error storing video:", error);
    }
  };

  const retrieveVideo = async () => {
    try {
      const db = await initDB();
      const transaction = db.transaction("videos", "readonly");
      const store = transaction.objectStore("videos");
      const request = store.get("recordedVideo");

      request.onsuccess = () => {
        const videoBlob = request.result;
        if (videoBlob) {
          const url = URL.createObjectURL(videoBlob);
          setVideoUrl(url);
        }
      };
    } catch (error) {
      console.error("Error retrieving video:", error);
    }
  };

  const startRecording = async () => {
    try {
      const mediaStream = await navigator.mediaDevices.getUserMedia({ video: true });
      setStream(mediaStream);
      if (videoRef.current) {
        videoRef.current.srcObject = mediaStream;
      }

      const recorder = new MediaRecorder(mediaStream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => chunks.push(e.data);
      recorder.onstop = () => {
        const videoBlob = new Blob(chunks, { type: "video/webm" });
        storeVideo(videoBlob);
        setRecordedChunks(chunks);
        const url = URL.createObjectURL(videoBlob);
        setVideoUrl(url);
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

  const simulateUpload = () => {
    const uploadSuccess = Math.random() > 0.5;
    if (uploadSuccess) {
      alert("Upload successful!");
    } else {
      alert("Upload failed, but video is stored locally.");
    }
  };

  useEffect(() => {
    retrieveVideo();
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex min-h-screen w-full max-w-3xl flex-col items-center justify-between py-32 px-16 bg-white dark:bg-black sm:items-start">
        <Image
          className="dark:invert"
          src="/next.svg"
          alt="Next.js logo"
          width={100}
          height={20}
          priority
        />
        <div className="flex flex-col items-center gap-6 text-center sm:items-start sm:text-left">
          <h1 className="max-w-xs text-3xl font-semibold leading-10 tracking-tight text-black dark:text-zinc-50">
            Video Recording with Local Backup
          </h1>
          <p className="max-w-md text-lg leading-8 text-zinc-600 dark:text-zinc-400">
            Record a video, store it locally, and simulate upload.
          </p>
        </div>
        <div className="flex flex-col gap-4 text-base font-medium sm:flex-row">
          <video
            ref={videoRef}
            className="w-full max-w-md rounded-lg"
            autoPlay
            playsInline
            controls={!!videoUrl}
            src={videoUrl || undefined}
          />
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
                className="flex h-12 items-center justify-center gap-2 rounded-full bg-foreground px-5 text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
              >
                Stop Recording
              </button>
            )}
            <button
              onClick={simulateUpload}
              className="flex h-12 items-center justify-center rounded-full border border-solid border-black/[.08] px-5 transition-colors hover:border-transparent hover:bg-black/[.04] dark:border-white/[.145] dark:hover:bg-[#1a1a1a]"
            >
              Simulate Upload
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
