"use client";

import dynamic from "next/dynamic";
import "react-quill-new/dist/quill.snow.css";

const ReactQuill = dynamic(() => import("react-quill-new"), { ssr: false });

const modules = {
  toolbar: [
    ["bold", "italic", "underline"],
    [{ list: "ordered" }, { list: "bullet" }],
    ["link"],
    ["clean"],
  ],
};

const formats = ["bold", "italic", "underline", "list", "link"];

export function OutreachEmailEditor({
  value,
  onChange,
  readOnly,
  placeholder,
}: {
  value: string;
  onChange: (html: string) => void;
  readOnly?: boolean;
  placeholder?: string;
}) {
  return (
    <div className="optic-gmail-editor overflow-hidden rounded-md border border-input bg-background">
      <ReactQuill
        theme="snow"
        value={value}
        onChange={(html, _delta, source) => {
          if (source !== "user") return;
          onChange(html);
        }}
        readOnly={readOnly}
        placeholder={placeholder}
        modules={modules}
        formats={formats}
      />
    </div>
  );
}
