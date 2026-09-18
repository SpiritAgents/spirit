import { useTheme } from "@/hooks/useTheme";
import { Toaster as UiToaster } from "@spiritagent/ui/sonner";
import type { ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  const { theme = "system" } = useTheme();
  return <UiToaster theme={theme} {...props} />;
}
