/** @vitest-environment jsdom */

import "./setup";

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { ProviderConnectDialog } from "@/components/settings/models/provider-connect-dialog";

function renderVertexDialog(overrides = {}) {
  const props = {
    provider: "google-vertex-ai",
    providerPresets: [{ id: "google-vertex-ai", label: "Google Vertex AI" }],
    open: true,
    onOpenChange: vi.fn(),
    busy: false,
    previewBusy: false,
    onAddModel: vi.fn().mockResolvedValue(undefined),
    onAddProviderModels: vi.fn().mockResolvedValue(undefined),
    onPreviewModels: vi.fn().mockResolvedValue({ modelIds: ["gemini-2.5-pro"], fromCache: false }),
    ...overrides,
  };
  render(<ProviderConnectDialog {...props} />);
  return props;
}

function fillVertexProjectAndLocation() {
  fireEvent.change(screen.getByLabelText("GCP Project ID"), {
    target: { value: "my-gcp-project" },
  });
  fireEvent.change(screen.getByLabelText("Location"), { target: { value: "us-central1" } });
}

test("vertex defaults to the ADC form: project/location only, no secret fields", () => {
  renderVertexDialog();

  const adcTab = screen.getByRole("tab", { name: "ADC" });
  expect(adcTab.getAttribute("aria-selected")).toBe("true");
  expect(screen.getByRole("tab", { name: "Service Account" })).toBeTruthy();
  expect(screen.getByRole("tab", { name: "Express API Key" })).toBeTruthy();

  expect(screen.getByLabelText("GCP Project ID")).toBeTruthy();
  expect(screen.getByLabelText("Location")).toBeTruthy();
  expect(screen.getByText(/Application Default Credentials/)).toBeTruthy();
  expect(screen.queryByLabelText("Service account client email")).toBeNull();
  expect(screen.queryByLabelText("Service account private key")).toBeNull();
  expect(screen.queryByLabelText("API Key")).toBeNull();

  // ADC needs project/location but no credentials before the catalog can be fetched.
  expect((screen.getByRole("button", { name: "Add Provider" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});

test("ADC connect previews and adds the catalog with credentialKind vertex and no credential slots", async () => {
  const props = renderVertexDialog();
  fillVertexProjectAndLocation();

  const connectButton = screen.getByRole("button", { name: "Add Provider" });
  expect((connectButton as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(connectButton);

  await waitFor(() => expect(props.onPreviewModels).toHaveBeenCalledTimes(1));
  const previewRequest = props.onPreviewModels.mock.calls[0]![0] as Record<string, unknown>;
  expect(previewRequest).toMatchObject({
    provider: "google-vertex-ai",
    credentialKind: "vertex",
    apiBase: "",
    apiKey: "",
    vertexProject: "my-gcp-project",
    vertexLocation: "us-central1",
    forceRefresh: false,
  });
  expect("vertexClientEmail" in previewRequest).toBe(false);
  expect("vertexPrivateKey" in previewRequest).toBe(false);

  await waitFor(() => expect(props.onAddProviderModels).toHaveBeenCalledTimes(1));
  const addRequest = props.onAddProviderModels.mock.calls[0]![0] as Record<string, unknown>;
  expect(addRequest).toMatchObject({
    provider: "google-vertex-ai",
    credentialKind: "vertex",
    apiBase: "",
    apiKey: "",
    modelIds: ["gemini-2.5-pro"],
    vertexProject: "my-gcp-project",
    vertexLocation: "us-central1",
  });
  expect("vertexClientEmail" in addRequest).toBe(false);
  expect("vertexPrivateKey" in addRequest).toBe(false);
  expect(props.onOpenChange).toHaveBeenCalledWith(false);
});

test("ADC mode does not leak a typed service-account secret into the request", async () => {
  const props = renderVertexDialog();

  fireEvent.click(screen.getByRole("tab", { name: "Service Account" }));
  fireEvent.change(screen.getByLabelText("Service account client email"), {
    target: { value: "svc@example.iam.gserviceaccount.com" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "ADC" }));
  fillVertexProjectAndLocation();
  fireEvent.click(screen.getByRole("button", { name: "Add Provider" }));

  await waitFor(() => expect(props.onPreviewModels).toHaveBeenCalledTimes(1));
  const previewRequest = props.onPreviewModels.mock.calls[0]![0] as Record<string, unknown>;
  expect(previewRequest.credentialKind).toBe("vertex");
  expect("vertexClientEmail" in previewRequest).toBe(false);
  expect("vertexPrivateKey" in previewRequest).toBe(false);
});

test("service-account mode still gates the catalog sync on client email and private key", () => {
  renderVertexDialog();

  fireEvent.click(screen.getByRole("tab", { name: "Service Account" }));
  expect(screen.queryByText(/Application Default Credentials/)).toBeNull();
  fillVertexProjectAndLocation();

  const connectButton = screen.getByRole("button", { name: "Add Provider" });
  expect((connectButton as HTMLButtonElement).disabled).toBe(true);

  fireEvent.change(screen.getByLabelText("Service account client email"), {
    target: { value: "svc@example.iam.gserviceaccount.com" },
  });
  fireEvent.change(screen.getByLabelText("Service account private key"), {
    target: { value: "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n" },
  });
  expect((connectButton as HTMLButtonElement).disabled).toBe(false);
});
