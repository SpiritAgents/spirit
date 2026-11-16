import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@spiritagent/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@spiritagent/ui/dropdown-menu";
import type { SpiritDesktopViewPageApi } from "@spiritagent/extension-toolkit/desktop-ui";
import "./style.css";

const view = (window as unknown as { spirit: { view: SpiritDesktopViewPageApi } }).spirit.view;

function Page() {
  const [step, setStep] = useState(0);
  const [clicks, setClicks] = useState(0);
  useEffect(
    () =>
      view.onContextChange((context) => {
        setStep((context.params as { step: number }).step);
      }),
    [],
  );
  useEffect(() => view.mounted(), []);
  return (
    <main className="space-y-4 p-4" data-native-page>
      <p data-step>{step}</p>
      <Button data-counter onClick={() => setClicks((value) => value + 1)}>
        Count {clicks}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">Actions</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem onSelect={() => view.close({ step, clicks })}>Finish</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </main>
  );
}

await view.ready();
createRoot(document.getElementById("root")!).render(<Page />);
