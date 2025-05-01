import { useState } from "react";

interface Props {
  images: string[];
  className?: string;
}

export default function ImageGallery({ images, className = "" }: Props) {
  const [current, setCurrent] = useState(0);
  return (
    <div className={`flex flex-col gap-4 ${className}`}>
      <img
        src={images[current]}
        alt="Product"
        /* fill container in both axes */
        className="rounded-xl shadow-lg w-full h-full min-w-full min-h-full object-cover"
      />
      <div className="flex gap-3 overflow-x-auto">
        {images.map((src, i) => (
          <button
            key={src}
            onClick={() => setCurrent(i)}
            className={`h-20 w-24 flex-shrink-0 border-2 rounded-lg overflow-hidden ${
              i === current ? "border-brand" : "border-transparent"
            }`}
          >
            {/* eslint-disable-next-line jsx-a11y/img-redundant-alt */}
            <img
              src={src}
              alt={`Thumbnail ${i + 1}`}
              className="object-cover w-full h-full"
            />
          </button>
        ))}
      </div>
    </div>
  );
}
