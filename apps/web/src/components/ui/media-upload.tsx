"use client";

import { useState, useRef } from 'react';
import { storage, ref, uploadBytes, getDownloadURL } from '@/lib/firebase';
import { Loader2, UploadCloud, X, CheckCircle2, PlayCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MediaUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onRemove: () => void;
  className?: string;
  folder?: string;
  label?: string;
  accept?: string;
}

export function MediaUpload({
  value,
  onChange,
  onRemove,
  className,
  folder = 'brand_assets',
  label = 'Upload Media',
  accept = "image/*,video/*"
}: MediaUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async (file: File) => {
    if (!file) return;
    setUploading(true);
    try {
      const storageRef = ref(storage, `${folder}/${Date.now()}_${file.name}`);
      await uploadBytes(storageRef, file);
      const url = await getDownloadURL(storageRef);
      onChange(url);
    } catch (error) {
      console.error("Upload error:", error);
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleUpload(file);
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleUpload(file);
  };

  // Improved video detection
  const isVideo = value?.toLowerCase().match(/\.(mp4|mov|webm|ogv)/) || value?.includes('video');

  return (
    <div className={cn("space-y-2 w-full", className)}>
      <div 
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        onClick={() => !value && !uploading && fileInputRef.current?.click()}
        className={cn(
          "relative min-h-[120px] rounded-xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center p-4 text-center",
          dragActive ? "border-primary bg-primary/5" : "border-muted-foreground/20 bg-muted/5 hover:bg-muted/10",
          value ? "border-solid border-primary/20" : "cursor-pointer",
          uploading && "opacity-50 cursor-not-allowed"
        )}
      >
        <input
          type="file"
          ref={fileInputRef}
          onChange={onFileChange}
          className="hidden"
          accept={accept}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Uploading...</p>
          </div>
        ) : value ? (
          <div className="w-full flex flex-col items-center gap-3">
             <div className="relative group">
                {isVideo ? (
                  <div className="relative max-h-[120px] aspect-video rounded-lg overflow-hidden bg-black flex items-center justify-center shadow-lg border border-primary/10">
                    <video src={value} className="h-full w-full object-cover opacity-60" />
                    <PlayCircle className="absolute h-10 w-10 text-white opacity-90 drop-shadow-md" />
                  </div>
                ) : (
                  <img src={value} alt="Uploaded" className="max-h-[120px] rounded-lg shadow-lg border border-primary/10 object-contain bg-white" />
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="absolute -top-2 -right-2 p-1.5 bg-destructive text-destructive-foreground rounded-full shadow-xl opacity-0 group-hover:opacity-100 transition-all hover:scale-110 active:scale-95 z-20"
                >
                  <X className="h-4 w-4" />
                </button>
             </div>
             <div className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100">
                <CheckCircle2 className="h-3 w-3" />
                Asset Secured
             </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 rounded-full bg-primary/10 text-primary">
               <UploadCloud className="h-6 w-6" />
            </div>
            <div>
               <p className="text-sm font-bold">{label}</p>
               <p className="text-[10px] text-muted-foreground mt-1 uppercase tracking-wider font-semibold">Images or High-Res Video</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
