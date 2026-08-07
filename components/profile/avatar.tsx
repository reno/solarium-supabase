import Image from "next/image";

// Presentational avatar: the uploaded image, or a gradient tile with the username's initial.
// Pure (no hooks), so it renders in server and client components alike.
export function Avatar({
  username,
  avatarUrl,
  size,
}: {
  username: string | null;
  avatarUrl: string | null;
  size: number;
}) {
  if (avatarUrl) {
    return (
      <div style={{ position: "relative", flex: "0 0 auto", overflow: "hidden", borderRadius: "var(--radius-pill)", background: "var(--surface-inset)", width: size, height: size }}>
        <Image src={avatarUrl} alt={username ?? "avatar"} fill sizes={`${size}px`} style={{ objectFit: "cover" }} unoptimized />
      </div>
    );
  }
  return (
    <div
      aria-hidden
      style={{
        display: "flex",
        flex: "0 0 auto",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--radius-pill)",
        background: "conic-gradient(from 180deg, var(--solar-2), var(--cyan-2), var(--solar-3))",
        color: "var(--text-on-accent)",
        fontWeight: "var(--weight-semibold)",
        width: size,
        height: size,
        fontSize: size / 2.5,
      }}
    >
      {(username ?? "?").slice(0, 1).toUpperCase()}
    </div>
  );
}
