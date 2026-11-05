import logoAsset from "@/assets/caf-ai-logo.jpg.asset.json";

export function CafAiLogo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <img
        src={logoAsset.url}
        alt="CAF AI"
        className="h-12 sm:h-14 w-auto object-contain rounded-lg ring-1 ring-primary/30 shadow-lg shadow-primary/20"
      />
    </div>
  );
}
