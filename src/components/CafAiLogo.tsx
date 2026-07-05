import logoAsset from "@/assets/caf-ai-logo.jpg.asset.json";

export function CafAiLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={logoAsset.url}
        alt="CAF AI"
        className="h-9 w-auto object-contain drop-shadow-[0_0_12px_oklch(0.72_0.18_240/0.35)]"
      />
    </div>
  );
}
