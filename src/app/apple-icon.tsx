import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// The hold mark at home screen size: the money's path with the yellow clamp on it.
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: 180, height: 180, background: "#17212b", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
        <div style={{ position: "absolute", left: 32, right: 32, top: 82, height: 16, borderRadius: 8, background: "#f3f5f2" }} />
        <div style={{ width: 52, height: 84, borderRadius: 20, background: "#f2b705", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
          <div style={{ width: 10, height: 32, borderRadius: 5, background: "#17212b" }} />
          <div style={{ width: 10, height: 32, borderRadius: 5, background: "#17212b" }} />
        </div>
      </div>
    ),
    size,
  );
}
