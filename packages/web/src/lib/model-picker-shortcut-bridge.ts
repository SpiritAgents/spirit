export type ModelPickerRegistration = {
  open(): void;
  getRoot(): HTMLElement | null;
};

type RegisteredPicker = ModelPickerRegistration & {
  id: string;
};

let nextPickerId = 0;
const registry = new Map<string, ModelPickerRegistration>();
let lastFocusedPickerId: string | null = null;

export function registerModelPicker(registration: ModelPickerRegistration): string {
  const id = `model-picker-${++nextPickerId}`;
  registry.set(id, registration);
  return id;
}

export function unregisterModelPicker(id: string): void {
  registry.delete(id);
  if (lastFocusedPickerId === id) {
    lastFocusedPickerId = null;
  }
}

export function notifyModelPickerFocused(id: string): void {
  if (registry.has(id)) {
    lastFocusedPickerId = id;
  }
}

export function resetModelPickerShortcutBridgeForTests(): void {
  registry.clear();
  lastFocusedPickerId = null;
  nextPickerId = 0;
}

function isPickerRootVisible(root: HTMLElement): boolean {
  if (!root.isConnected) {
    return false;
  }
  const style = getComputedStyle(root);
  if (style.display === "none" || style.visibility === "hidden") {
    return false;
  }
  const rect = root.getBoundingClientRect();
  return rect.width > 0 || rect.height > 0;
}

function listVisiblePickers(): RegisteredPicker[] {
  const visible: RegisteredPicker[] = [];
  for (const [id, registration] of registry.entries()) {
    const root = registration.getRoot();
    if (root && isPickerRootVisible(root)) {
      visible.push({ id, ...registration });
    }
  }
  return visible;
}

function pickerContainsActiveElement(picker: RegisteredPicker): boolean {
  const root = picker.getRoot();
  const active = document.activeElement;
  if (!root || active == null || typeof root.contains !== "function") {
    return false;
  }
  return root.contains(active);
}

/** Resolve which model picker should open for Cmd/Ctrl + /. */
export function resolveModelPickerToOpen(): ModelPickerRegistration | null {
  const visible = listVisiblePickers();
  if (visible.length === 0) {
    return null;
  }

  const focusedPicker = visible.find((picker) => pickerContainsActiveElement(picker));
  if (focusedPicker) {
    return focusedPicker;
  }

  if (lastFocusedPickerId) {
    const lastFocused = visible.find((picker) => picker.id === lastFocusedPickerId);
    if (lastFocused) {
      return lastFocused;
    }
  }

  if (visible.length === 1) {
    return visible[0] ?? null;
  }

  return null;
}
