import { Download, FileImage, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { exportNodeAsImage } from "@/lib/analyzer/export";

export function ExportMenu({ targetRef, name }: {
  targetRef: React.RefObject<HTMLElement | null>;
  name: string;
}) {
  const doExport = async (fmt: "png" | "jpeg") => {
    if (!targetRef.current) return;
    try {
      await exportNodeAsImage(targetRef.current, name, fmt);
    } catch (e) {
      toast.error("Export failed", { description: e instanceof Error ? e.message : "Unknown error" });
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Export chart"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <Download className="h-3.5 w-3.5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={() => doExport("png")}>
          <FileImage className="mr-2 h-4 w-4" /> PNG image
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => doExport("jpeg")}>
          <FileText className="mr-2 h-4 w-4" /> JPEG image
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
