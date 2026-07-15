/**
 * PixelForge 製の待ち工程ループアニメ(GIF)。
 * image-rendering: pixelated でドットをくっきり保ったまま表示する
 */
export function PixelAnim({ src, alt }: { src: string; alt: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      className="w-full max-w-[480px] border-2 border-[#3a2a12]"
      style={{ imageRendering: "pixelated", background: "#040201" }}
    />
  );
}
