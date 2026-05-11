"use client";

import { useState, useRef } from 'react';
import { storage, ref, uploadBytes, getDownloadURL } from '@/lib/firebase';
import { Loader2, UploadCloud, X, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ImageUploadProps {
  value?: string;
  onChange: (url: string) => void;
  onRemove: () => void;
  className?: string;
  folder?: string;
  label?: string;
}

export function ImageUpload({
  value,
  onChange,
  onRemove,
  className,
  folder = 'brand_assets',
  label = 'Upload Image'
}: ImageUploadProps) {
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
          accept="image/*"
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm font-medium">Uploading...</p>
          </div>
        ) : value ? (
          <div className="w-full flex flex-col items-center gap-3">
             <div className="relative group">
                <img src={value} alt="Uploaded" className="max-h-[100px] rounded-lg shadow-sm" />
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onRemove(); }}
                  className="absolute -top-2 -right-2 p-1.5 bg-destructive text-destructive-foreground rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <X className="h-3 w-3" />
                </button>
             </div>
             <div className="flex items-center gap-1.5 text-xs font-medium text-green-600 bg-green-50 px-2 py-1 rounded-full">
                <CheckCircle2 className="h-3 w-3" />
                Success
             </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="p-3 rounded-full bg-primary/10 text-primary">
               <UploadCloud className="h-6 w-6" />
            </div>
            <div>
               <p className="text-sm font-semibold">{label}</p>
               <p className="text-xs text-muted-foreground mt-1">Drag and drop or click to browse</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
