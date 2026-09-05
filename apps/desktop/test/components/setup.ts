/**
 * Shared setup for component tests (jsdom). Imported at the top of each
 * `test/components/*.test.tsx` file, right after the environment pragma.
 */
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Initializes the shared i18next instance with all locales; under jsdom the
// system language resolves to en, so assertions use English strings.
import "@/lib/i18n";

// React 19 + RTL 16: opt into the act environment so render/fireEvent wrap in act.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// vitest runs without globals here, so RTL cannot auto-clean; do it explicitly.
afterEach(cleanup);
