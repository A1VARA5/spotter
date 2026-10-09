import { ImageResponse } from "next/og";

export const alt = "Spotter: a second look before the money goes";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The link preview: the promise, and the hold track holding £250 between Gran and a stranger.
export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 1200,
          height: 630,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "radial-gradient(70% 70% at 80% 30%, rgba(242,183,5,0.18), rgba(13,20,28,0) 70%), #0d141c",
          color: "#fff",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 34, fontWeight: 700 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, background: "#17212b", border: "2px solid #2a3642", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
            <div style={{ position: "absolute", left: 9, right: 9, top: 24, height: 4, borderRadius: 2, background: "#f3f5f2" }} />
            <div style={{ width: 16, height: 26, borderRadius: 6, background: "#f2b705" }} />
          </div>
          Spotter
        </div>
        <div style={{ display: "flex", fontSize: 84, fontWeight: 700, letterSpacing: -3, lineHeight: 1, maxWidth: 900 }}>A second look before the money goes.</div>
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 28, color: "#aeb9c3" }}>
          <span style={{ color: "#fff", fontWeight: 600 }}>Gran</span>
          <div style={{ width: 160, height: 4, background: "#3a4652", borderRadius: 2 }} />
          <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: "#f2b705", color: "#17212b", fontWeight: 700 }}>£250 on hold</div>
          <div style={{ width: 160, height: 4, background: "#3a4652", borderRadius: 2 }} />
          <span style={{ color: "#fff", fontWeight: 600 }}>&quot;new number&quot;</span>
        </div>
      </div>
    ),
    size,
  );
}
