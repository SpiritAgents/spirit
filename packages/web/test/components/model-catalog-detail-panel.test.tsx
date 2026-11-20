/** @vitest-environment jsdom */

import "./setup";

import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";

import { ModelCatalogDetailPanel } from "@spiritagent/ui/model-picker";
import { Badge } from "@/components/ui/badge";
import { UiTestProviders } from "./ui-test-providers";

test("renders additional role badges alongside model capabilities", () => {
  render(
    <UiTestProviders>
      <ModelCatalogDetailPanel
        model={{
          name: "secondary-model",
          providerId: "test-provider",
          ref: { providerId: "test-provider", name: "secondary-model" },
          capabilities: ["languageModel", "image"],
        }}
        providerLabel="Provider"
        additionalBadges={
          <Badge variant="secondary" className="text-[10px] text-secondary-foreground">
            Secondary Language Model
          </Badge>
        }
      />
    </UiTestProviders>,
  );

  expect(screen.getByText("Secondary Language Model")).toBeTruthy();
  expect(screen.getByText("Language Model")).toBeTruthy();
  expect(screen.getByText("Image")).toBeTruthy();
});
