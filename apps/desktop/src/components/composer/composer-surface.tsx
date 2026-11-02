import {
  ComposerSurface as UiComposerSurface,
  type ComposerSurfaceProps as UiComposerSurfaceProps,
} from "@spiritagent/ui/composer";
import type { ModelPickerShortcutTarget } from "@spiritagent/ui/model-picker";
import { ComposerEditCommandPlugin } from "@/lib/composer-lexical/plugins/composer-edit-command-plugin";
import {
  notifyModelPickerFocused,
  registerModelPicker,
  unregisterModelPicker,
} from "@/lib/model-picker-shortcut-bridge";
import type { DesktopSnapshot } from "@/types";

const modelPickerShortcutTarget: ModelPickerShortcutTarget = {
  register: registerModelPicker,
  unregister: unregisterModelPicker,
  notifyFocused: notifyModelPickerFocused,
};

/**
 * Desktop adapter of the shared composer surface: snapshot-typed props and the
 * Cmd+/ picker shortcut bridge. Labels/localization and model semantics come from
 * the app-root providers (App.tsx).
 */
export type ComposerSurfaceProps = Omit<
  UiComposerSurfaceProps,
  "models" | "catalogHints" | "providers" | "providerPresets"
> & {
  models: DesktopSnapshot["config"]["models"];
  catalogHints?: DesktopSnapshot["config"]["modelCatalogHints"];
  providers?: DesktopSnapshot["config"]["providers"];
  providerPresets?: DesktopSnapshot["config"]["providerPickerPresets"];
};

export function ComposerSurface(props: ComposerSurfaceProps) {
  return (
    <UiComposerSurface
      {...props}
      modelPickerShortcutTarget={modelPickerShortcutTarget}
      extraPlugins={<ComposerEditCommandPlugin />}
    />
  );
}
