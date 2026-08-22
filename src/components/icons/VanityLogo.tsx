export function VanityLogo({
  className = "",
  size = 32,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <img
      src="/logo_source.png"
      width={size}
      height={size}
      alt=""
      aria-hidden="true"
      className={`object-contain ${className}`}
      draggable={false}
    />
  );
}

export const VANITY_LOGO_SVG_STRING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"></svg>`;
