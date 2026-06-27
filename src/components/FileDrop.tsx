import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Upload, FileSpreadsheet } from "lucide-react";
import { cn } from "@/lib/utils";

export function FileDrop({
  label,
  hint,
  fileName,
  onFile,
  className,
}: {
  label: string;
  hint?: string;
  fileName?: string | null;
  onFile: (file: File) => void;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border bg-card p-8 text-center transition-colors hover:border-primary/50",
        className,
      )}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <div className="rounded-full bg-secondary p-3 text-secondary-foreground">
        {fileName ? <FileSpreadsheet className="h-6 w-6" /> : <Upload className="h-6 w-6" />}
      </div>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
      </div>
      {fileName ? (
        <div className="text-xs text-emerald-700">Loaded: {fileName}</div>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => ref.current?.click()}>
          Choose file
        </Button>
      )}
      <input
        ref={ref}
        type="file"
        accept=".xlsx,.xls,.xlsm,.csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}
