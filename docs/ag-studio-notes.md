# AG Studio notes (for Next.js 16 App Router + React 19 + TS)

Researched 2026-10-10 against AG Studio **3.0.0**. Sources: the official docs (fetched as raw markdown via `https://www.ag-grid.com/studio/react/<page>.md`), the `.d.ts` files of `ag-studio@3.0.0` / `ag-studio-react@3.0.0` installed into a temp dir, the live example sources under `https://www.ag-grid.com/studio/examples/...`, the two blog posts, and one real Next.js integration on GitHub.

Tags used below:
- **[docs]** copied from official docs
- **[d.ts]** copied from the package type declarations
- **[tested]** I ran it locally
- **[3rd party]** from someone else's public repo, not official
- **[own]** my own code or inference, not confirmed by AG Grid

---

## 1. Packages, versions, peer deps, SSR

`npm view` (2026-10-10):

| Package | Version | Notes |
|---|---|---|
| `ag-studio-react` | 3.0.0 | deps: `ag-grid-enterprise ~36.2.0`, `ag-grid-react ~36.2.0`, `ag-stack ~36.2.0`, `ag-studio 3.0.0` |
| `ag-studio` | 3.0.0 | deps: `ag-grid-enterprise ~36.2.0`, `ag-charts-enterprise ~14.2.0`, `ag-stack ~36.2.0`, `tslib ^2.3.0` |
| `ag-studio-locale` | 3.0.0 | optional, 31 languages |
| (also `ag-studio-angular`, `ag-studio-vue3`) | 3.0.0 | not needed |

- Peer deps of `ag-studio-react`: `react: '^17.0.0 || ^18.0.0 || ^19.0.0'`, `react-dom` same. **React 19 is supported.**
- Licence field on npm: `Commercial`.
- Install: `npm install ag-studio-react` (pulls `ag-studio`). **[docs]** "`ag-studio-react` and `ag-studio` versions must be identical". AG Studio 3.0 requires AG Grid **36.2** and AG Charts **14.2**. This project already has `ag-grid-community ^36.2.0` + `ag-grid-react ^36.2.0`, which matches.
- TypeScript: docs say AG Studio 2-3 needs TS `>= 5.8.3`. Project uses TS `^7.0.2`, not listed in their table **[own: should be fine, untested]**.
- Compatibility table: React 17-19+ with AG Studio 2-3+.
- Standalone AG Grid instances on the same page must use the **Theming API**, not legacy CSS themes **[docs]**.

### SSR / Next.js
- The package ships **no `"use client"` directive** (grep of `ag-studio-react/dist` found none). Any file importing `AgStudio` must be a client component (`"use client"`), and functions (`ai`, callbacks, `widgets` builder) cannot be passed from a server component anyway.
- **[tested]** `require('ag-studio')` and `require('ag-studio-react')` load in plain Node without crashing, and `renderToString(<AgStudio .../>)` returns an empty shell (`<div><div><div><div></div></div></div></div>`). So it will not crash SSR, it just renders nothing useful server side. It ships a `useIsomorphicLayoutEffect`.
- **[tested]** Bundle size: `import { AgStudio } from 'ag-studio-react'` bundled with esbuild (react external, minified) = **5.3 MB min, ~1.5 MB gzip**. Raw: `ag-studio/dist/package/main.esm.min.mjs` 1.8 MB plus grid and charts enterprise.
- **Recommendation [own]**: put Studio in its own client component file and load it with `next/dynamic(() => import('./studio'), { ssr: false })` from a client wrapper, so the 1.5 MB gzip only lands on the dashboard route. The real Next.js integration I found does exactly this (`"loaded in the browser only (insights-board.tsx imports this file with next/dynamic and ssr: false)"` **[3rd party]**). In App Router, `ssr: false` is only allowed inside a client component.
- **No CSS import is needed.** No `.css` files ship in the package; themes inject their CSS from JS (Theming API). Props `themeCssLayer`, `styleNonce` (CSP) and `themeStyleContainer` exist if needed.
- `AgStudio` fills its parent: "Render the `AgStudio` component inside a sized parent (it automatically fills the available space)" **[docs]**. Give the wrapper an explicit height.

---

## 2. Minimal React code

### Quick start [docs, verbatim]
```jsx
import { AgStudio } from 'ag-studio-react';

// Data to display in Studio (can also be loaded asynchronously)
const productData = [
    {
        productName: 'Printer',
        category: 'Printing & Imaging',
        brand: 'CleanSlate Office',
        listPrice: 109.09,
        unitCost: 92.26,
    },
    // ... more rows
];

const App = () => {
    const data = {
        sources: [{
            id: 'products',
            data: productData,
        }],
    };

    return (
        <div style={{ height: '100%', width: '100%' }}>
            <AgStudio data={data} mode="edit" />
        </div>
    );
};
```
- Component: `AgStudio` (from `ag-studio-react`). Ref type: `AgStudioRef` (`ref.current.api` is `AgStudioApi`).
- `mode`: `'view'` (default) or `'edit'`.
- Dev validations (call once, before any Studio is created):
```js
import { enableStudioDevValidations } from 'ag-studio';

if (process.env.NODE_ENV !== 'production') {
    enableStudioDevValidations();
}
```

### How data is supplied
`data` prop: `AgDataSourcesDefinition | AgDataEngine`. Arrays of plain objects; each array is a source (table). Fields are inferred, or declared:

`AgDataSourcesDefinition` props **[docs]**: `sources`, `relationships` (joins between tables), `expressions` (calculated columns), `formats`, `description` (AI-facing dataset overview), `calendars`, `buckets`, `options`.

Sync source (`AgSimpleDataSourceDefinition`): `id`, `name`, `description` (AI-facing), `data`, `fields`.

Field definition (subset) **[docs]**: `id`, `name`, `description`, `hide`, `format` (`'textFormat' | 'integerFormat' | 'decimalFormat' | 'booleanFormat' | 'dateFormat' | 'dateTimeFormat' | 'percentageFormat' | 'currencyFormat'`), `formatOptions` (`{ format: '£#,##0.00' }` Excel-style), `accessor`, `cardinality`, `notBlank`.

```jsx
// [docs] field formats
sources: [{
    fields: [
        { id: 'priceGBP', format: 'currencyFormat', formatOptions: { format: '£#,##0.00' } },
        { id: 'discount', format: 'percentageFormat', formatOptions: { format: '#,##0.0%' } },
        { id: 'orderDate', format: 'dateFormat', formatOptions: { format: 'dd mmm yyyy' } },
    ],
}],
```
- Date fields want real `Date` objects. The 3rd-party integration converts ISO strings to `new Date(...)` before passing rows in **[3rd party]**.
- Reload sync data by passing new `data` (same sources/fields only; you cannot add/remove sources or change fields this way) **[docs]**.
- Async source: `{ id, dataShape: 'row' | 'column', getData: async (tableId) => ({ data }), tables: [{ id, fields }] }`, optional `capabilities: { filter, sort, pagination }` and `pageSize`. Reload with `api.reload()` **[docs]**.
- For huge data or your own SQL backend: "Custom Engine" / Server-Side Data (`createDataEngine`) **[docs, not studied in depth]**.

**React best practice [docs]**: keep `data`, `initialState`, `panels`, `layout` etc. in `useState`/`useMemo`, and callbacks in `useCallback`, otherwise Studio resets state or recalculates every render.

### Defining the initial dashboard in code [docs, verbatim from State page]
Field ids are `"<sourceId>.<fieldId>"`. Layout is a 24-column track grid.
```ts
const HARDCODED_STATE: AgReportState = {
  pages: [
    {
      id: "page-1",
      widgets: {
        "1": {
          type: "grid",
          dataMapping: {
            cols: [
              { id: "medals.country" },
              { id: "medals.sport" },
              { id: "medals.gold", aggregation: "sum" },
              { id: "medals.total", aggregation: "sum" },
            ],
          },
        },
        "2": {
          type: "column-chart-grouped",
          dataMapping: {
            categoryKey: [{ id: "medals.country" }],
            valueKey: [
              { id: "medals.gold", aggregation: "sum" },
              { id: "medals.silver", aggregation: "sum" },
              { id: "medals.bronze", aggregation: "sum" },
            ],
          },
        },
      },
      widgetLayout: {
        "1": { xTrack: 0, yTrack: 0, xSpan: 24, ySpan: 16 },
        "2": { xTrack: 0, yTrack: 16, xSpan: 24, ySpan: 16 },
      },
    },
  ],
  selectedPageId: "page-1",
  panels: {
    filters: {
      collapsed: true,
    },
  },
};

<AgStudio initialState={HARDCODED_STATE} ... />
```
KPI tile state **[docs, widget catalogue]**:
```ts
{
  type: "value",
  dataMapping: {
    value: [{ id: "medals.gold", aggregation: "sum" }],
  },
  format: {
    title: {
      enabled: true,
      text: "Total Gold Medals",
    },
  },
}
```
Tip from docs: "we strongly recommend creating state in the UI and then retrieving it from Studio" (build it in edit mode, `getState()`, paste into code).

### Saving / loading state [docs]
- `initialState` (read once at init).
- `ref.current.api.getState()` / `api.setState(fullState)` (full object, immutable updates, Studio diffs by reference).
- Events: `onStateUpdated={({ state }) => ...}` (type `AgStudioStateUpdatedEvent`), `onStudioPreDestroyed={({ state }) => ...}`, `onApiReady={(e) => e.api}`.
- `version` is stamped on state from `getState()`; Studio auto-migrates older state. Always persist state read from Studio.
- Invalid state: best effort load, emits `errorRaised` with `errorType: 'state'` (`fatal: true` in view mode).
- Switch page: `api.setState({ ...api.getState(), selectedPageId: 'page-2' })`.
- Switch mode from code: `api.setProperty('mode', 'view')`.

Other props seen in the reference **[docs]**: `theme`, `loadThemeGoogleFonts`, `panels`, `layout`, `widgets`, `components`, `context`, `localeText`, `aiText`, `aiToolDisplay`, `ai`, `enableFilterEditingInViewMode`, `history` (undo/redo), `dataOptions`, `popupParent`, `studioId`, `modules`.

---

## 3. Licence

- Apply the key **[docs, verbatim]**:
```jsx
import { AgStudio, AgStudioProvider } from "ag-studio-react";

function App() {
    return (
        <AgStudioProvider licenseKey="YOUR_LICENCE_KEY">
            <AgStudio /* ... props */ />
        </AgStudioProvider>
    );
}

// For older versions use the LicenseManager and ModuleRegistry directly

// import { AgStudioLicenseManager } from "ag-studio";
// AgStudioLicenseManager.setLicenseKey("YOUR_LICENCE_KEY");
```
  `AgStudioProvider` props **[d.ts]**: `modules?: AgStudioModule[]`, `licenseKey?: string`, `children`. Providers can nest.
- **Without a key [docs]**: "You can test AG Studio locally without a licence. To test in production, access support, and remove the watermark and console warnings, Request a Trial Licence."
- **[tested, read from bundle]** All features work without a key ("All ... features are unlocked for trial"). The watermark logic is:
  ```js
  isDisplayWatermark() {
    const eDocument = this.document;
    return isForceWatermark(eDocument) || !isLocalhost(eDocument) && !isWebsiteUrl(eDocument) && !!this.watermarkMessage?.length;
  }
  ```
  so **no watermark on `localhost`/`127.0.0.1`**, but a watermark (AG Studio logo bottom right, class `.ag-studio-watermark`) on any deployed host such as `*.vercel.app`, plus console messages like "License Key Not Found" and "If you want to hide the watermark please email info@ag-grid.com for a trial license key". Append `forceWatermark` to the URL path to preview it locally.
- **Trial**: "Start your 45-day enterprise trial ... Full enterprise features, 45 days of access, Engineering support", no watermarks. Request at https://www.ag-grid.com/studio/license-pricing/?tab=trial (form). Pricing is custom/quote only.
- AI: the AI troubleshooting table says "A licence error in the console - The key does not include AI." So the trial key must cover the AI module. The blog says the trial "includes the Studio Agent Framework".
- An AG Studio licence covers built-in grid/chart widgets only. **Using AG Grid Enterprise or AG Charts Enterprise inside a custom widget needs their own licences** **[docs]**.
- Keep the key in an env var. It ends up in the browser bundle either way (`NEXT_PUBLIC_...`), which is normal for AG licence keys **[own]**.

---

## 4. Custom widgets and theming

### Custom widget [docs, verbatim from live example source]
`interfaces.tsx`:
```ts
import type { AgBaseRegistry, AgBaseWidgetDefinition, AgWidgetDataFormat, AgWidgetFieldReference } from 'ag-studio';

interface CustomWidgetStyle {
    valueFontSize?: number;
}

export interface CustomDef {
    type: 'customWidget';
    dataMapping: {
        value: AgWidgetFieldReference[];
    };
    format?: AgWidgetDataFormat<CustomWidgetStyle>;
}

export interface MyRegistry extends AgBaseRegistry {
    widgets: readonly AgBaseWidgetDefinition<'customWidget', CustomDef>[];
}
```
`customWidget.tsx`:
```tsx
import type { AgWidgetParams } from 'ag-studio';
import type { CSSProperties } from 'react';
import React, { useEffect, useRef, useState } from 'react';

import type { CustomDef } from './interfaces';

export default ({ dataMapping, widgetApi, format }: AgWidgetParams<CustomDef>) => {
    const [value, setValue] = useState<string>();
    const hasLoaded = useRef(false);
    const valueFontSize = format?.style?.valueFontSize;
    useEffect(() => {
        const fetchData = async () => {
            const field = dataMapping.value?.at(0);
            if (!field) {
                widgetApi.setDisplayState('incompleteDataMapping');
                return;
            }
            widgetApi.setDisplayState('loading', { prominent: !hasLoaded.current });
            const response = await widgetApi.getData({ fields: [field] });
            const data = response.results.rows;
            const newValue = data.at(0)?.[field.key];
            const hasData = newValue != null;
            hasLoaded.current = hasData;
            setValue(widgetApi.formatFieldValue(field, newValue));
            widgetApi.setDisplayState(hasData ? 'displayed' : 'noData');
        };
        fetchData();
    }, [dataMapping]);

    return (
        <div
            className="custom-widget-container"
            style={{ '--custom-widget-value-font-size': valueFontSize ? `${valueFontSize}px` : null } as CSSProperties}
        >
            <div className="custom-widget-desc">Custom widget</div>
            <div className="custom-widget-value">{value ?? ''}</div>
        </div>
    );
};
```
Registration (inside the component):
```tsx
import { createWidgets } from "ag-studio-react"; // NOT from ag-studio
import CustomWidget from "./customWidget.tsx";

const widgets = useMemo<
  | AgWidgetsConfig<MyRegistry>
  | ((widgets: AgWidgetsConfig<AgDefaultRegistry>) => AgWidgetsConfig<MyRegistry>)
>(() => {
  return createWidgets<MyRegistry>({
    additionalTypes: [
      {
        id: "customWidget",
        icon: { url: "https://www.ag-grid.com/studio/images/brandmark.svg" },
        label: "Custom Widget",
        dataMapping: {
          value: {
            type: "field",
            supportedRoles: ["numeric"],
            requires: { cardinality: "one" },
            required: true,
          },
        },
        form: (params: AgWidgetFormParams<CustomDef>) => {
          const defaultForm = params.createDefaults({
            dataMappingItems: [{ key: "value", label: "Value" }],
          });
          defaultForm.items[1].items.push({
            type: "number",
            id: "format.style.valueFontSize",
            label: "Value Font Size",
            defaultValue: 48,
          });
          return defaultForm;
        },
        comp: CustomWidget,
        defaultSize: { width: 400, height: 300 },
        minSize: { width: 200, height: 100 },
        ai: {
          description: "Custom widget used for displaying values in an interesting way.",
        },
      },
    ],
    menu: [{ label: "Custom", widgetIds: ["customWidget"] }],
  });
}, []);

<AgStudio<MyRegistry> widgets={widgets} ... />
```
To keep the built-in menu too, use the function form: `const widgets = (widgetConfig) => createWidgets<CustomRegistry>({ additionalTypes: [...], menu: [...widgetConfig.menu, { label: 'Custom', widgetIds: ['customWidget'] }] });` **[docs]**.

`AgWidgetDefinition` keys **[docs]**: `id`, `label`, `icon` (SVG string | `{ className }` | `{ url }`), `dataMapping`, `formatShape`, `form`, `defaultState`, `extends` (only to override built-ins), `comp` (React component, string key into `components`, or TS class), `defaultSize`, `minSize`, `toolbar` (default `['duplicate','delete']`), `featureConfig`, `options`, `ai`.

Data mapping keys **[docs]**: `type: 'field' | 'fieldset'`, `supportedRoles: ['category' | 'numeric' | 'temporal']`, `requires: { cardinality: 'one' | 'many', per?: 'dataMapping.<key>' }`, `required`, `sort`, `aiDescription`.

Widget params **[docs]**: `api`, `context`, `widgetId`, `widgetType`, `format`, `dataMapping`, `sort`, `config`, `widgetApi`.
- `widgetApi.setDisplayState('displayed' | 'loading' | 'noData' | 'incompleteDataMapping', meta?)`
- `widgetApi.getData({ kind?: 'flat', fields, sort, filter, limit }, { queryId? })` (page, widget and cross filters are applied automatically). Pass a distinct `queryId` for multiple parallel queries or later ones cancel earlier ones.
- `widgetApi.getSchema()` lists all tables and fields.
- `widgetApi.formatFieldValue(field, value)`.
- Cross filter from a custom widget: `toggleCrossFilter`, `resetCrossFilter`, `getCrossFilterSelections`, e.g.
  ```ts
  api.toggleCrossFilter({
      type: 'multiValue',
      values: [
          { field: channelField, value: 'Online' },
          { field: productField, value: 'Clothing' },
      ],
      group: 0,
  });
  ```
  and `featureConfig: { crossFilter: { supportsHighlight: true } }` to get both `response.results` and `response.crossFilter`.
- Third-party popups inside a widget need class `ag-custom-component-popup`.
- Using AG Charts in a widget: `theme: getChartTheme(api)`, `background: { fill: 'transparent' }`; AG Grid in a widget: `theme: studioGridTheme` (both exported from `ag-studio`).
- **AI + custom widgets [docs]**: "For a custom widget to work with AI, the `formatShape` and `ai` properties must be defined." Studio exports no public shape builder; the 3rd-party repo reuses the built-in value widget's shape: `const valueShape = defaults.widgets.find((w) => w.id === "value")?.formatShape;` inside the `widgets` function form **[3rd party, works around a gap]**. Their `ai` object also uses `label` and `usage` keys **[3rd party, not checked in d.ts]**.
- The "88 seconds" blog's registry entry uses `category()`, `numeric()`, `formWithoutCrossFilter(...)`. **These are helpers from their workshop starter repo, not exported by `ag-studio`** (the export list has no such names). Do not copy them as API.

### Theming [docs]
Same Theming API as AG Grid. Default theme is `studioTheme` from `ag-studio`.
```jsx
const theme = studioTheme.withParams({
    gridCellTextColor: 'pink',
    chartAxisLineColor: 'blue',
});
<AgStudio theme={theme} />
```
CSS variable form: param name in kebab-case with `--ag-` prefix (`foregroundColor` -> `--ag-foreground-color`).
Param families: shared (no prefix), `studio*` (UI chrome), `grid*` (grid widgets), `chart*` (chart widgets). Colour modes: `data-ag-theme-mode="light|dark|dark-blue|<custom>"` on `<html>`/`<body>` or on an ancestor with class `ag-theme-mode`; custom modes via `.withParams({...}, 'mode-name')`. Visual builder: https://www.ag-grid.com/studio/theme-builder/ (exports `studioTheme.withParams({...})`).

Confirmed param names (from the theme reference) useful for the brand: `accentColor`, `backgroundColor`, `foregroundColor`, `textColor`, `subtleTextColor`, `borderColor`, `borderRadius`, `fontFamily`, `fontSize`, `fontWeight`, `invalidColor`, `browserColorScheme`, `menuBackgroundColor`, `tooltipBackgroundColor`, `tooltipTextColor`, `studioCanvasBackgroundColor`, `studioCanvasFontFamily`, `studioWidgetBackgroundColor`, `studioWidgetTitleFontFamily`, `studioWidgetTitleFontWeight`, `studioWidgetTitleFontSize`, `studioWidgetTitleTextColor`, `studioPanelContainerBackgroundColor`, `studioPanelHeaderFontFamily`, `chartFontFamily`, `chartTextColor`, `chartAccentColor`, `chartPaletteFills1Color` ... `chartPaletteFills20Color`, `chartPaletteStrokes1Color` ... `chartPaletteStrokes20Color`, `gridFontFamily` (grid-prefixed versions of AG Grid params). KPI sparklines take the chart palette.

Brand theme **[own, built only from the confirmed names above; untested]**:
```ts
"use client";
import { studioTheme } from "ag-studio";

const FONT = '"Schibsted Grotesk", ui-sans-serif, system-ui, sans-serif';
// or with next/font: 'var(--font-schibsted), ui-sans-serif, sans-serif'

export const spotterTheme = studioTheme.withParams({
  fontFamily: FONT,
  chartFontFamily: FONT,
  gridFontFamily: FONT,
  studioWidgetTitleFontFamily: FONT,
  studioWidgetTitleFontWeight: 700,
  browserColorScheme: "light",
  backgroundColor: "#F3F5F2",      // chalk
  foregroundColor: "#17212B",      // ink
  textColor: "#17212B",
  accentColor: "#2C55C9",          // blue (selection, focus, checkboxes)
  invalidColor: "#BE3328",         // red
  studioCanvasBackgroundColor: "#F3F5F2",
  studioWidgetBackgroundColor: "#FFFFFF",
  tooltipBackgroundColor: "#17212B",
  tooltipTextColor: "#F3F5F2",
  chartPaletteFills1Color: "#2C55C9",
  chartPaletteFills2Color: "#F2B705",
  chartPaletteFills3Color: "#1F7A55",
  chartPaletteFills4Color: "#BE3328",
  chartPaletteFills5Color: "#17212B",
  chartPaletteStrokes1Color: "#2C55C9",
  chartPaletteStrokes2Color: "#F2B705",
  chartPaletteStrokes3Color: "#1F7A55",
  chartPaletteStrokes4Color: "#BE3328",
  chartPaletteStrokes5Color: "#17212B",
});

// <AgStudio theme={spotterTheme} loadThemeGoogleFonts />   // Schibsted Grotesk is on Google Fonts
// or load the font yourself with next/font and pass loadThemeGoogleFonts={false}
```
`loadThemeGoogleFonts`: "If your theme uses a font that is available on Google Fonts, pass true to load it from Google's CDN" **[docs]**. Icons: `studioIconOverrides({ type: 'image', icons: { 'double-chevron-right': { url } } })`.
Note: there is no dedicated "positive/negative" or "up/down" colour param that I found; red/green would have to come from palette order, KPI `format.style.color`, or custom widgets.

---

## 5. Agent framework

### Imports (all exist in the 3.0.0 export list) [d.ts]
```ts
import { AgStudio, AgStudioProvider, createWidgets } from 'ag-studio-react';
import {
  AgStudioAiModule, createAiHarness, directLlmRunner, clientToolRunner,
  type AgAiHarnessSetup, type AgAiModel, type AgAiPromptStarter, type AgLlmAdapter,
  type AgLlmRequest, type AgLlmResponse, type AgLlmResponseHandler, type AgAiEvent,
  type AgAiTool, type AgAiToolSchema, type AgAiRunInput,
} from 'ag-studio';
```
Runtime exports of `ag-studio` 3.0.0 (non-underscore): `AgAiCommandError AgStudioAiModule AgStudioLicenseManager AgStudioModuleRegistry AgWidgetExpansionService AI_MODEL_SELECTION_KEY DEFAULT_AI_STRINGS DEFAULT_LOCALE THEME_DEFAULTS aiModelFromRunInput clientToolRunner createAiHarness createAiToolContext createBuckets createDataEngine createFormats createStudio createStudioTheme createWidgets directLlmRunner enableStudioDevValidations getChartTheme iconSetStudio isCalendarRelation isDataRelation studioGridTheme studioIconOverrides studioTheme`. `ag-studio-react`: `AgStudio AgStudioProvider GridWidget PivotGridWidget createWidgets`.

### Enable + minimal wiring [docs]
```jsx
<AgStudioProvider modules={[AgStudioAiModule]}>
    <AgStudio /* ... props */ />
</AgStudioProvider>
```
(or `<AgStudio modules={modules} />` with a memoised array, or `AgStudioModuleRegistry.registerModules([AgStudioAiModule])`.)
```jsx
const ai = ({ api }) => createAiHarness(api, { adapter });
<AgStudio ai={ai} />
```
Full form from the examples:
```tsx
const ai = useMemo<AgAiHarnessSetup>(() => {
  return ({ api }) =>
    createAiHarness(api, {
      adapter,
      promptStarters: PROMPT_STARTERS,   // AgAiPromptStarter[]: { label, prompt, icon? }
      models: MODELS,                    // AgAiModel[]: { id, label, efforts?: { id, label }[] }
    });
}, []);
```
`createAiHarness(api: AgStudioApi, build: AgAiHarnessConfigBuilder | AgAiHarnessDefaults): AgAiHarness` **[d.ts]**.
- `AgAiHarnessDefaults`: `adapter` (required), `primary?: AgBuiltInAgentId`, `models?`, `history?: AgAiHistoryStore`, `promptStarters?`, `observers?: AgAiTelemetryObserver[]`.
- `AgAiHarnessConfig` (builder form): `agents: AgAnyAiAgentRunner[]`, `primary: string`, plus `models`, `history`, `promptStarters`, `observers`.
- Conversations are in memory unless you pass `history` (`AgAiHistoryStore`: `listThreads`, `loadThread`, `saveThread`, `deleteThread`, `addEventListener`, `removeEventListener`). Chat history is not part of `AgReportState`.

### Adapters
**AG Studio ships no adapters, and there is no Anthropic/Claude or OpenAI-compatible adapter in the package** [docs: "AG Studio does not provide any adapters. Our examples contain an adapter for OpenAI's Responses API which can be repurposed for other providers."]. The quick-start's `import { openaiAdapter } from 'ag-studio-harness/example-shared/openaiAdapter'` is labelled "Example adapter, not a shipped API". The full example adapter source is in the appendix at the bottom of this file (fetched from the live example).

The interface you implement **[d.ts, verbatim]**:
```ts
export interface AgLlmAdapter {
    executeTurn(request: AgLlmRequest, options?: AgLlmExecuteTurnOptions): AgLlmResponseHandler;
}
export interface AgLlmExecuteTurnOptions {
    signal?: AbortSignal;
    trace?: AgAiTraceContext;
}
export interface AgLlmRequest {
    input: AgAiConversationItem[];
    instructions?: string;
    tools?: AgAiToolSchema[];
    toolChoice?: 'auto' | 'none' | 'required' | AgLlmToolChoice;   // AgLlmToolChoice = { name: string }
    responseFormat: AgLlmTextFormat | AgLlmJsonFormat;            // { type: 'text' } | { type: 'json', name, description?, schema }
    model?: AgAiModelSelection;                                    // { id: string; effort?: string }
}
export interface AgLlmResponseHandler {
    stream: {
        [Symbol.asyncIterator](): AsyncIterator<AgAiEvent>;
    };
    complete: Promise<AgLlmResponse>;
}
export interface AgLlmResponse {
    id: string;
    createdAt: number;
    error?: AgLlmResponseError;                 // { code: string; message: string }
    incompleteDetails?: AgLlmResponseIncompleteDetails; // { reason?: 'max_output_tokens' | 'content_filter' }
    output: AgAiOutputItem[];
    status: 'completed' | 'failed' | 'in_progress' | 'cancelled' | 'queued' | 'incomplete';
    usage?: AgAiUsage;
    model?: string;
}
export interface AgAiToolSchema {
    name: string;
    description: string;
    parameters: AgJSONSchema;     // JSON Schema draft 2020-12, uses $defs/$ref
    kind?: AgAiToolKind;          // 'client' | 'server' | 'provided'
    provider?: unknown;
}
```
Conversation items (OpenAI-Responses-like shape) **[d.ts]**:
```ts
type AgAiConversationItem = AgAiInputMessage | AgAiOutputMessage | AgAiToolCall | AgAiToolCallResult | AgAiReasoningItem;
// AgAiInputMessage:  { id, kind: 'input', type: 'message', role: 'user' | 'system', content: ({type:'text',text} | {type:'image',...} | {type:'file',...})[], status }
// AgAiOutputMessage: { id, kind: 'output', type: 'message', role: 'assistant', status, content: ({ type: 'text', text, annotations: [] } | { type: 'refusal', refusal })[] }
// AgAiToolCall:      { id, kind: 'output', type: 'function_call', callId, name, arguments: string /* JSON */, status?, result? }
// AgAiToolCallResult:{ id?, kind?: 'input', type: 'function_call_output', callId, output: string, status }
// AgAiReasoningItem: { id, kind: 'output', type: 'reasoning', summary: {type:'summary',text}[], content?: {type:'text',text}[] }
type AgAiOutputItem = AgAiOutputMessage | AgAiReasoningItem | AgAiToolCall;
```
Rules **[docs]**: the adapter does NOT execute tools. It sends `request.tools` to the LLM and relays tool calls back as stream events and in `complete.output`. Studio executes them and sends results back as `function_call_output` items next turn. Emit content events only (no `RUN_*`/`STEP_*`). A failed turn is reported by `complete` (the example rejects it), not by a stream event. `options.signal` must go to `fetch`. For `kind === 'provided'` tools, pass `tool.provider` through untouched.

Provider gotchas from docs + example: OpenAI strict mode needs every property in `required` (optional = nullable) and strips nulls on the way back; root `anyOf` schemas are rejected by several providers; Shape emits `{ not: {} }` as an "undefined" sentinel. These matter for Claude too **[own: Anthropic tool `input_schema` is more lenient than OpenAI strict mode, but still verify `$defs`/`$ref` handling]**.

### Keeping the API key server side
Docs **[docs]**: "`executeTurn` runs in the browser, so calling a provider directly exposes your API key. For production, point `executeTurn` at your own backend endpoint instead: forward the `AgLlmRequest`, call the provider server-side with your secret key, and stream the response back. The adapter contract is unchanged - only the URL it calls differs."

Two routes:
1. **Direct LLM Runner + proxy adapter** (simplest; Studio runs the loop in the browser, every turn POSTs to `/api/...`). The 3rd-party Next.js app does this with a non-streaming proxy **[3rd party, verbatim core]**:
```ts
export function geminiProxyAdapter(endpoint = "/api/insights/llm"): AgLlmAdapter {
  return {
    executeTurn(request: AgLlmRequest, options) {
      // Started at once, so `complete` settles whether or not the stream is read.
      const reply: Promise<AgLlmResponse> = fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { ...request, tools: request.tools?.filter((t) => t.kind !== "provided") } }),
        signal: options?.signal,
      }).then(async (res) => {
        const body = (await res.json().catch(() => null)) as TurnReply | null;
        if (!res.ok || !body?.response) throw new Error(body?.error ?? `The assistant's server answered ${res.status}.`);
        return body.response;
      });
      reply.catch(() => {});
      async function* events(): AsyncGenerator<AgAiEvent> {
        let response: AgLlmResponse;
        try {
          response = await reply;
        } catch {
          return; // The failure is reported once, on `complete`.
        }
        for (const item of response.output) {
          if (item.type === "message") {
            const text = item.content.map((c) => (c.type === "text" ? c.text : c.refusal)).join("");
            yield { type: "TEXT_MESSAGE_START", messageId: item.id, role: "assistant" };
            yield { type: "TEXT_MESSAGE_CONTENT", messageId: item.id, delta: text };
            yield { type: "TEXT_MESSAGE_END", messageId: item.id };
          } else if (item.type === "function_call") {
            yield { type: "TOOL_CALL_START", toolCallId: item.callId, toolCallName: item.name };
            yield { type: "TOOL_CALL_ARGS", toolCallId: item.callId, delta: item.arguments };
            yield { type: "TOOL_CALL_END", toolCallId: item.callId };
          }
        }
      }
      const it = events();
      return { stream: { [Symbol.asyncIterator]: () => it }, complete: reply };
    },
  };
}
```
   The server route then maps `AgLlmRequest` -> provider call -> `AgLlmResponse` JSON. For Claude **[own mapping, untested]**: `instructions` -> `system`; `input` items -> `messages` (input/output text -> user/assistant text blocks; `function_call` -> assistant `tool_use` block `{ id: callId, name, input: JSON.parse(arguments) }`; `function_call_output` -> user `tool_result` block `{ tool_use_id: callId, content: output }`; consecutive same-role items must be merged); `tools` -> `{ name, description, input_schema: parameters }`; `toolChoice` -> `tool_choice` (`auto`/`any`/`{type:'tool',name}`/`none`); response `text` blocks -> `AgAiOutputMessage`, `tool_use` blocks -> `AgAiToolCall` with `callId = tool_use.id`, `arguments = JSON.stringify(input)`; `stop_reason: 'max_tokens'` -> `status: 'incomplete'`. Add cost caps and auth on the route.
2. **Client Tool Runner** (your server owns each turn and streams AG-UI events; Studio executes the client tools in the page and calls you again) **[docs]**:
```ts
clientToolRunner({
    id: 'analyst',
    description: 'Builds dashboards from a natural-language request.',
    schema: (s) => s.undefined(),
    tools: () => [studio.viewSchema(), studio.addWidget()],
    run: async function* (input, ctx) {
        // yield events until the run is done
    },
});
```
   `run(input: AgAiRunInput, ctx: AgAiAgentRunContext)` returns `AsyncIterable<AgAiEvent>`. `input` has `threadId, runId, messages (AG-UI style: role user/assistant/system/tool/developer), tools, state, context, forwardedProps`. `ctx` has `params`, `instructions()`, `tools()`, `signal`, `completeTask?`, `emit?`. Studio emits `RUN_STARTED/RUN_FINISHED` itself and drops yours. Emit `RUN_ERROR` instead of throwing. `run` is re-called after every round that asked for a client tool, so a scripted loop must branch on `input.messages.some(m => m.role === 'tool')`. With route 2 you lose the built-in five-agent team unless you rebuild it (the built-ins are definitions; `builtIn` can be paired with any runner: `clientToolRunner({ ...definition, run })` **[own inference from "Re-pair the same definitions with directLlmRunner, clientToolRunner, or a plain { ...definition, run }" docs]**).

Third option, Custom Runner: `{ id, tools, run: myOwnLoop }`, you emit everything including run boundaries.

### Built-in agents [docs]
| Agent | Role | Tools | Delegates to |
|---|---|---|---|
| **Lead** (`lead`) | Coordinator. Reads the request, decides the approach, delegates. | `view_schema`, `view_report`, `view_page`, `view_plan`, `update_plan`, `clear_plan`, `rename_thread`, `delegate_to` | `data`, `page`, `planning`, `widget` |
| **Planning** | Turns a request into a structured plan. | `view_schema`, `view_report`, `view_page`, `view_plan`, `create_plan` | - |
| **Data** | Explores and queries the data; answers data questions. | `execute_query`, `view_schema`, `create_expression`, `update_expression`, `delete_expression` | - |
| **Page** | Places and moves widgets, manages page-level filters. | `view_schema`, `view_page`, `view_plan`, `add_widget`, `position_widget`, `remove_widget`, `add_page_filter`, `remove_page_filter` | - |
| **Widget** | Configures one widget: type, data mapping, titles, formatting. | `view_schema`, `view_plan`, `view_widget`, `configure_widget`, `add_widget_filter`, `remove_widget_filter` | - |

Flow for "build me a dashboard": lead `view_schema` -> planning `create_plan` -> page `add_widget` + `position_widget` -> one widget agent per widget (concurrently) `configure_widget` -> lead summarises. Default `maxTurns` 100.

Using/extending them **[docs]**:
```ts
createAiHarness(api, ({ builtIn, tools: { studio } }) => ({
    agents: [
        ...Object.values(builtIn).map((definition) => directLlmRunner({ ...definition, adapter })),
        directLlmRunner({
            id: 'audit',
            adapter,
            description: 'Reviews a page for missing or misleading widgets.',
            instructions: () => 'You review dashboards and report what is missing.',
            tools: () => [studio.viewPage(), studio.viewWidget()],
        }),
    ],
    primary: 'lead',
}));
```
The built-in lead delegates to a fixed id set, so a new agent is only reachable if you write your own lead with a wider `tools.delegateTo([...])`.

Built-in tool methods on `tools.studio` (or `api.getAiTools()`): `viewSchema() viewReport() viewPage() viewWidget() executeQuery() addWidget() positionWidget() removeWidget() configureWidget({ widgetType, widgetId }) createExpression() updateExpression() deleteExpression() addPageFilter() removePageFilter() addWidgetFilter() removeWidgetFilter()`. Each accepts `{ name?, description? }` overrides; page tools accept `{ pageId }` binding. Harness tools: `tools.plan.view() / create() / update() / clear()`, `tools.renameThread()`, `tools.delegateTo([ids])`; `complete_task` is auto-added to delegated runs.

Delegation with params **[docs]**:
```ts
directLlmRunner<{ region: string }>({
    id: 'regional-analyst',
    adapter,
    description: 'Answers questions about one region.',
    schema: (s) => s.object({ region: s.string() }),
    instructions: ({ region }) => `You only discuss the ${region} region.`,
    tools: () => [studio.executeQuery()],
});
```
Warning **[docs]**: an agent without params must declare `schema: (s) => s.undefined()`, not an empty object, or the primary agent fails to start. Instructions/tools must be callbacks (re-resolved per run), never snapshotted arrays.

Agent definition fields **[docs]**: `id`, `name`, `description`, `schema`, `instructions`, `tools`, `defaultToolCalls`, `maxTurns`.

Guardrail approach the docs push: limit what the agent can do by **which tools you list** ("An agent with no mutating tools cannot change the dashboard, whatever the model decides"). `execute_query` returns real rows to the model; field and table names travel in tool schemas.

### Custom tool [docs + d.ts]
```ts
const listReportsTool = api.defineAiTool({
    name: 'list_reports',
    description: 'List the saved reports this user can open.',
    params: (s) =>
        s.object({
            team: s.string({ description: 'Restrict to one team. Omit for all teams.' }).optional(),
        }),
    execute: async (args, ctx) => {
        const reports = await fetchReports({ team: args.team, signal: ctx.signal });
        if (reports.length === 0) {
            return ctx.error('No reports found. Ask the user to widen the search.');
        }
        return ctx.success(`Found ${reports.length} reports.`, { reports });
    },
});
```
Param builder helpers: `s.object, s.string({description}), s.number, s.boolean, s.enum([...]), .optional(), s.undefined()`, plus live enums `s.widgetId(), s.widgetType(), s.pageId()`. Args are validated before `execute`; failures go back to the model.

`AgAiTool` shape **[d.ts, verbatim]**:
```ts
export interface AgAiTool {
    name: string;
    description: string;
    kind: AgAiToolKind;                 // 'client' | 'server' | 'provided'
    schema(): AgAiToolSchema | undefined;
    execute?(call: AgAiToolInvocation, ctx: AgAiToolContext): Promise<AgAiToolResult>;
}
export interface AgAiToolInvocation { toolCallId: string; name: string; args: Record<string, unknown>; }
export interface AgAiToolContext {
    signal: AbortSignal;
    run: AgAiToolRunContext;            // { threadId: string; runId: string }
    success<TData>(response: string, data?: TData): AgAiToolSuccess<TData>;
    error(messages: string | string[]): AgAiToolError;
}
export type AgAiToolResult<TData = unknown> = AgAiToolSuccess<TData> | AgAiToolError;
// AgAiToolSuccess = { success: true; response: string; data?: TData }
// AgAiToolError   = { success: false; issues: { message: string; path?: ... }[] }
```
`defineAiTool` config variants **[d.ts]**: `{ name, description, params, execute }` (execute form), `{ name, description, command, result }` (command form, e.g. `command: api.defineAiCommand({ type: 'AgAddWidgetCommand' })`), `{ kind: 'server', name, description, params }`, `{ kind: 'provided', name, description, provider }`. Built-in command refs: `AgExecuteQueryCommand AgAddWidgetCommand AgPositionWidgetCommand AgRemoveWidgetCommand AgConfigureWidgetCommand AgAddPageFilterCommand AgRemovePageFilterCommand AgAddWidgetFilterCommand AgRemoveWidgetFilterCommand`. Commands never throw (`command.apply(args, { signal })` returns `{ success, ... }`).

Add to an agent: `tools: () => [studio.viewSchema(), studio.executeQuery(), listReportsTool]`. Tool display in the panel: `aiToolDisplay` prop, keyed by tool name (labels + optional React component) **[docs: ai-tool-components page, not read in full]**. Change tool descriptions globally with `aiText={{ 'tools.add_widget.description': '...' }}`.

### Chat panel [docs]
Built in. Appears once `ai` is set and the module is registered. Control with `initialState.panels.ai.collapsed`. Shows messages, streamed tool-call steps, delegations inline (expandable), plan artefacts as cards, a thread list. Model picker when `models` set; prompt starters on an empty thread. UI strings via `localeText` keys prefixed `ai` (e.g. `aiNewChat`, `aiMessageInputPlaceholder`). Panel placement via the `panels` prop; the 3rd-party app uses `panels={{ edit: { right: ["ai", "edit", "data", "filters"] }, view: { right: ["filters"] } }}` **[3rd party; shape not checked against d.ts]**. You can render your own chat UI from the harness session instead ("Your own UI" / custom harness pages, not read in full).

Troubleshooting **[docs]**: no chat panel = module not registered or `ai` not set; "AI is unavailable" = `primary` names an agent not in `agents`; licence error = key does not include AI; agent replies but never acts = adapter not relaying tool calls.

### Events (AG-UI) [d.ts]
`AgAiEventType`: `RUN_STARTED RUN_FINISHED RUN_ERROR STEP_STARTED STEP_FINISHED TEXT_MESSAGE_START TEXT_MESSAGE_CONTENT TEXT_MESSAGE_END TEXT_MESSAGE_CHUNK TOOL_CALL_START TOOL_CALL_ARGS TOOL_CALL_END TOOL_CALL_RESULT TOOL_CALL_CHUNK REASONING_MESSAGE_START REASONING_MESSAGE_CONTENT REASONING_MESSAGE_END REASONING_MESSAGE_CHUNK STATE_SNAPSHOT STATE_DELTA MESSAGES_SNAPSHOT RAW CUSTOM`.
Key shapes:
```ts
{ type: 'TEXT_MESSAGE_START', messageId: string, role: 'assistant' }
{ type: 'TEXT_MESSAGE_CONTENT', messageId: string, delta: string }
{ type: 'TEXT_MESSAGE_END', messageId: string }
{ type: 'TOOL_CALL_START', toolCallId: string, toolCallName: string, parentMessageId?: string }
{ type: 'TOOL_CALL_ARGS', toolCallId: string, delta: string }   // JSON fragment
{ type: 'TOOL_CALL_END', toolCallId: string }
{ type: 'REASONING_MESSAGE_START', messageId: string, role?: 'reasoning' } // + _CONTENT / _END
{ type: 'RUN_ERROR', message: string, code?: string }
{ type: 'TEXT_MESSAGE_CHUNK', messageId?: string, role?: 'assistant', delta?: string } // shorthand, also TOOL_CALL_CHUNK / REASONING_MESSAGE_CHUNK
{ type: 'CUSTOM', name: string, value: unknown } / { type: 'RAW', event: unknown, source?: string }
```
No `@ag-ui/*` dependency; types are hand-written and "structurally compatible, not guaranteed identical".

Also exists, not studied: WebMCP support (`/studio/react/ai-webmcp/`), Agent Context `api.getAiContext().schema()` / `.health.page()`, telemetry observers, AG Studio "skills" page.

---

## 6. Cross-filtering, KPIs, charts, alerts

- **Cross-filtering [docs]**: on by default per widget. Modes per widget (Edit panel): **Cross Highlight** (pie, doughnut, bar, column), **Cross Filter** (redraws), **None**. Click again clears; Ctrl for multi-select. Active cross filters show as cards in a Cross Filters section of the Filters panel. Docs example sets KPI widgets to None so totals ignore selections. Custom widgets opt in with `widgetApi.toggleCrossFilter(...)`.
- **Filters**: page filters, widget filters, selection / simple / rank filters, and on-canvas **filter widgets**: `list-filter`, `button-filter`, `date-filter`. `enableFilterEditingInViewMode` lets viewers add/remove filters.
- **KPI / value widgets**: `value` (KPI, single aggregated number, optional sparkline via `dataMapping.sparklineX`, `format.style.color`, typography, `textScaling`), `radial-gauge`, `linear-gauge` (`format.style.scaleLabel.min/max`, radial `secondaryLabel` like "of target").
- **All built-in widget type ids** (from `extends` union) **[docs]**: `value grid pivot-grid column-chart-grouped column-chart-stacked column-chart-stacked-100 bar-chart-grouped bar-chart-stacked bar-chart-stacked-100 line-chart area-chart area-chart-stacked area-chart-stacked-100 scatter-chart bubble-chart radar-line-chart radar-area-chart radial-column-chart nightingale-chart radial-bar-chart pie-chart donut-chart funnel-chart cone-funnel-chart pyramid-chart treemap-chart sunburst-chart radial-gauge linear-gauge button-filter list-filter date-filter text image combo-chart-grouped-column-line combo-chart-stacked-column-line`. No built-in map, sankey or quadrant: those are custom-widget examples (sankey, UK choropleth via AG Charts `map-shape`, quadrant in the blog).
- **Conditional formatting**: only via Excel-style format strings on fields, e.g. `[>1000000]#,##0.0,,"M";[>1000]#,##0.0,"K";#,##0` and `#,##0.00;(#,##0.00);"-"`. I found **no colour rules, thresholds or "alerts" feature** in docs or types. Alerts would have to be your own logic (e.g. a custom widget, a KPI with `format.style.color` set from code, or an agent tool).
- Also available: calculated columns and measures (expressions), calendars/date buckets, undo/redo, CSV export, multi-page reports, relationships between tables.

---

## 7. Gotchas

1. **Size**: ~1.5 MB gzip (5.3 MB min). Lazy load with `next/dynamic` + `ssr: false` on the dashboard route only.
2. **`"use client"`** required on any file importing `ag-studio-react` (package has no directive).
3. **Sized parent**: Studio fills its container; zero-height parent = invisible Studio.
4. **No CSS import**; theme CSS is injected at runtime. If using a CSP, pass `styleNonce`. `themeCssLayer` exists for Tailwind `@layer` ordering.
5. **Memoise** `data`, `initialState`, `widgets`, `ai`, `panels`, `theme`, `modules` (`useState`/`useMemo`/`useCallback`), otherwise state resets / data recalcs.
6. **Version lock**: `ag-studio` == `ag-studio-react`; AG Grid 36.2 / AG Charts 14.2. Standalone grids must use the Theming API.
7. **Watermark** appears on any non-localhost host without a key (deployed demo on Vercel will show it). Get the 45-day trial before deploying.
8. **AI licence**: key must include AI, or a console licence error.
9. **Never ship provider keys to the browser**: the docs' own examples use a browser-side adapter with an empty token against `https://ai-api.ag-grid.com/api/openai/v1` (their demo proxy); production must go through your own route.
10. **Custom widgets + AI** need `formatShape` and `ai`, and there is no public shape builder (3rd-party workaround: reuse the `value` widget's `formatShape`).
11. **Using AG Charts / AG Grid Enterprise inside a custom widget** needs separate licences.
12. Agents with no params need `schema: (s) => s.undefined()`.
13. JSON Schema from tools is draft 2020-12 with `$defs`/`$ref`; root `anyOf` breaks some providers; OpenAI strict mode needs the null/required rewrite (see adapter appendix).
14. Dates in data should be `Date` objects.
15. React 19 is in the peer range, but the package's own devDeps build against React 18.3 types; I did not render it under React 19 in a browser **[untested]**.

---

## Real-world reference (3rd party)
`github.com/ZNLong2203/handback` (`components/insights/studio.tsx`, `agent.tsx`, `theme.ts`) is a Next.js App Router app in the same PayPal hackathon using AG Studio with: `next/dynamic` + `ssr:false`, `AgStudioProvider modules={...} licenseKey={...}`, a custom theme with light/dark custom modes, two custom widgets with AI metadata, a Gemini proxy adapter (`/api/insights/llm`), and a custom front agent whose tools call server routes. Good for patterns, do not copy (it is a competitor's entry). The official hackathon boilerplate `github.com/paypaldev/hackathon-paypal-ag-grid-boilerplate` is Next 16.3.6 + React 19.2.8 + `@paypal/paypal-server-sdk` and does **not** include AG Studio yet.

Hackathon context: AG Grid blog "Hackathon: PayPal and AG Studio" (1 Oct 2026). Prize "Best Use of AG Studio": $5,000 / $2,000 / 3 x $1,000. Their idea list includes "An anomaly-alert agent: monitors transaction streams and auto-builds widgets flagging suspicious refund spikes or failed payments" and "A natural-language finance agent". Live session 12 Oct 2026.

---

## Appendix: official example OpenAI Responses adapter (verbatim)
Source: `https://www.ag-grid.com/studio/examples/ai-quickstart/ai-quickstart-example/reactFunctionalTs/shared/openaiAdapter.tsx` (labelled "example code - copy it into your project and adapt as needed"). Default model in it: `gpt-5.4-mini`, default endpoint `https://api.openai.com/v1`, it POSTs to `${endpoint}/responses` with `stream: true`.

```ts
/**
 * OpenAI Responses API adapter for AG Studio.
 *
 * This is example code - copy it into your project and adapt as needed.
 * It maps between AG Studio's AI types and the OpenAI Responses API,
 * handling encoding (AG → OpenAI), decoding (OpenAI → AG), and SSE streaming.
 */
import type {
    AgAiConversationItem,
    AgAiEvent,
    AgAiOutputContent,
    AgAiOutputItem,
    AgAiOutputMessage,
    AgAiReasoningItem,
    AgAiToolSchema,
    AgLlmAdapter,
    AgLlmJsonFormat,
    AgLlmRequest,
    AgLlmResponse,
    AgLlmResponseHandler,
    AgLlmTextFormat,
} from 'ag-studio';

// =============================================================================
// OpenAI Types (hand-written, minimal)
// =============================================================================

interface OpenAiAdapterOptions {
    key?: string;
    endpoint?: string;
    model?: string;
    organization?: string;
}

interface OpenAiConfig {
    endpoint: string;
    key?: string;
    model: string;
    organization?: string;
}

// =============================================================================
// JSON Schema → OpenAI strict-mode subset
// =============================================================================
//
// The Shape library emits JSON Schema 2020-12. OpenAI's Responses API in
// `strict: true` mode accepts only a narrow subset. This transform bridges the
// two so docs examples work against OpenAI without forcing Shape authors to
// know the quirks.
//
// What OpenAI accepts: object/array/string/number/integer/boolean/enum/anyOf,
// `$ref` + `$defs` (including recursive), `additionalProperties: false`, and
// the standard string/number/array constraint keywords. Every key in
// `properties` must appear in `required`; optional fields are encoded as a
// nullable type. Open-ended `additionalProperties: <schema>` (i.e. Shape's
// `s.record(...)`) is **not** representable.

type JsonSchema = Record<string, unknown>;

const BANNED_KEYWORDS = [
    'allOf',
    'not',
    'oneOf',
    'if',
    'then',
    'else',
    'prefixItems',
    'patternProperties',
    'propertyNames',
    'unevaluatedProperties',
    'unevaluatedItems',
    'dependentSchemas',
    'dependentRequired',
    'contains',
] as const;

function isSchema(value: unknown): value is JsonSchema {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Shape encodes "undefined" (used in `union(T, undefined)` to mark optionality) as the
// sentinel `{ not: {} }`. OpenAI doesn't allow `not`, so strip these from any `anyOf`
// branches; the surrounding object handler turns the remaining schema nullable for
// optional properties.
function isUndefinedSentinel(s: unknown): boolean {
    if (!isSchema(s)) return false;
    return Object.keys(s).length === 1 && isSchema(s.not) && Object.keys(s.not as JsonSchema).length === 0;
}

function stripUndefinedSentinel(schema: JsonSchema): JsonSchema {
    if (!Array.isArray(schema.anyOf)) return schema;
    const filtered = (schema.anyOf as unknown[]).filter((b) => !isUndefinedSentinel(b));
    if (filtered.length === schema.anyOf.length) return schema;
    if (filtered.length === 0) {
        throw new Error('toOpenAiSchema: schema reduces to `undefined`-only - nothing to express');
    }
    const { anyOf: _, ...rest } = schema;
    if (filtered.length === 1 && isSchema(filtered[0])) {
        return { ...filtered[0], ...rest } as JsonSchema;
    }
    return { ...rest, anyOf: filtered as JsonSchema[] };
}

function inferTypeFromValue(v: unknown): string | undefined {
    if (v === null) return 'null';
    if (typeof v === 'string') return 'string';
    if (typeof v === 'boolean') return 'boolean';
    if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
    return undefined;
}

function makeNullable(schema: JsonSchema): JsonSchema {
    if (typeof schema.type === 'string') {
        return schema.type === 'null' ? schema : { ...schema, type: [schema.type, 'null'] };
    }
    if (Array.isArray(schema.type)) {
        return schema.type.includes('null') ? schema : { ...schema, type: [...schema.type, 'null'] };
    }
    if (Array.isArray(schema.anyOf)) {
        const branches = schema.anyOf as JsonSchema[];
        const hasNull = branches.some((b) => isSchema(b) && b.type === 'null');
        return hasNull ? schema : { ...schema, anyOf: [...branches, { type: 'null' }] };
    }
    return { anyOf: [schema, { type: 'null' }] };
}

function transformSchema(schema: JsonSchema): JsonSchema {
    schema = stripUndefinedSentinel(schema);

    // OpenAI strict mode rejects any sibling keyword on `$ref` (description, examples, etc.).
    // Shape authors apply per-callsite descriptions on the outside of the def - preserve `$ref`
    // itself, drop everything else; the description lives inside the referenced `$def` via the
    // first emission.
    if ('$ref' in schema) {
        const { $ref, $defs } = schema as JsonSchema & { $ref: unknown };
        return $defs !== undefined ? { $ref, $defs } : { $ref };
    }

    for (const kw of BANNED_KEYWORDS) {
        if (kw in schema) {
            throw new Error(`toOpenAiSchema: '${kw}' is not supported by OpenAI strict mode`);
        }
    }

    if ('const' in schema) {
        const { const: literalValue, ...rest } = schema as JsonSchema & { const: unknown };
        const inferred = inferTypeFromValue(literalValue);
        const out: JsonSchema = { ...rest, enum: [literalValue] };
        if (out.type == null && inferred != null) out.type = inferred;
        return transformSchema(out);
    }

    const out: JsonSchema = { ...schema };

    if (Array.isArray(out.anyOf)) {
        out.anyOf = (out.anyOf as JsonSchema[]).map((branch) => (isSchema(branch) ? transformSchema(branch) : branch));
    }

    if (isSchema(out.$defs)) {
        const transformedDefs: JsonSchema = {};
        for (const [k, v] of Object.entries(out.$defs as JsonSchema)) {
            transformedDefs[k] = isSchema(v) ? transformSchema(v) : v;
        }
        out.$defs = transformedDefs;
    }

    if (out.type === 'object' || isSchema(out.properties)) {
        if ('additionalProperties' in out && out.additionalProperties !== false) {
            throw new Error(
                'toOpenAiSchema: open-ended `additionalProperties` (e.g. s.record(...)) cannot be expressed in OpenAI strict mode'
            );
        }
        const properties = isSchema(out.properties) ? out.properties : {};
        const required = new Set(Array.isArray(out.required) ? (out.required as string[]) : []);
        const newProperties: JsonSchema = {};
        for (const [key, propSchema] of Object.entries(properties)) {
            const transformed = isSchema(propSchema) ? transformSchema(propSchema) : propSchema;
            newProperties[key] = required.has(key)
                ? transformed
                : isSchema(transformed)
                  ? makeNullable(transformed)
                  : transformed;
        }
        out.properties = newProperties;
        out.required = Object.keys(newProperties);
        out.additionalProperties = false;
    }

    // Array items keep their real schema: only optional PROPERTIES need the required+nullable
    // rewrite. Advertising nullable items invites the model to emit `[null]` for values the
    // AG-side shapes reject.
    if (isSchema(out.items)) {
        out.items = transformSchema(out.items);
    }

    return out;
}

function toOpenAiSchema(schema: JsonSchema): JsonSchema {
    if (Array.isArray(schema.anyOf) && schema.type !== 'object' && !isSchema(schema.properties)) {
        throw new Error(
            'toOpenAiSchema: root schema cannot be `anyOf` - wrap in an object (e.g. `s.object({ value: ... })`)'
        );
    }
    return transformSchema(schema);
}

// =============================================================================
// Encoding: AG → OpenAI
// =============================================================================

function encodeConversationItems(items: AgAiConversationItem[]): unknown[] {
    return items.map((item) => {
        if (item.kind === 'input' && item.type === 'message') {
            return {
                type: 'message',
                role: item.role,
                status: item.status,
                content: item.content.map((c) => {
                    switch (c.type) {
                        case 'text':
                            return { type: 'input_text', text: c.text };
                        case 'image':
                            return {
                                type: 'input_image',
                                detail: c.detail,
                                file_id: c.fileId ?? null,
                                image_url: c.imageUrl ?? null,
                            };
                        case 'file':
                            return {
                                type: 'input_file',
                                file_id: c.fileId ?? null,
                                file_data: c.fileData,
                                file_url: c.fileUrl,
                                filename: c.filename,
                            };
                    }
                }),
            };
        }

        if (item.type === 'function_call_output') {
            return {
                type: 'function_call_output',
                call_id: item.callId,
                output: item.output,
                status: item.status,
            };
        }

        if (item.kind === 'output' && item.type === 'message') {
            // No `id`: replayed history is reconstructed conversational context, not a resumed
            // OpenAI response. Echoing the original `msg_…` id makes the API treat it as response
            // state and demand the linked `reasoning` item (which a view-derived history lacks).
            return {
                type: 'message',
                role: 'assistant',
                status: item.status,
                content: item.content.map((c) => {
                    if (c.type === 'text') {
                        return {
                            type: 'output_text',
                            text: c.text,
                            annotations: c.annotations.map((ann) => {
                                switch (ann.type) {
                                    case 'file_path':
                                        return { type: 'file_path', file_id: ann.fileId, index: ann.index };
                                    case 'file_citation':
                                        return {
                                            type: 'file_citation',
                                            file_id: ann.fileId,
                                            index: ann.index,
                                            filename: ann.filename,
                                        };
                                    case 'url_citation':
                                        return {
                                            type: 'url_citation',
                                            url: ann.url,
                                            start_index: ann.startIndex,
                                            end_index: ann.endIndex,
                                            title: ann.title,
                                        };
                                    case 'container_file_citation':
                                        return {
                                            type: 'container_file_citation',
                                            container_id: ann.containerId,
                                            file_id: ann.fileId,
                                            start_index: ann.startIndex,
                                            end_index: ann.endIndex,
                                            filename: ann.filename,
                                        };
                                }
                            }),
                        };
                    }
                    return { type: 'refusal', refusal: c.refusal };
                }),
            };
        }

        if (item.kind === 'output' && item.type === 'function_call') {
            // No `id` (same reason as the assistant message above): `call_id` alone pairs the call
            // with its `function_call_output`, and a reconstructed `id` isn't a valid `fc_…` anyway.
            return {
                type: 'function_call',
                call_id: item.callId,
                name: item.name,
                arguments: item.arguments,
                status: item.status,
            };
        }

        if (item.kind === 'output' && item.type === 'reasoning') {
            return {
                id: item.id,
                type: 'reasoning',
                summary: item.summary.map((s) => ({ type: 'summary_text', text: s.text })),
                content: item.content?.map((c) => ({ type: 'reasoning_text', text: c.text })),
            };
        }

        throw new Error(`Unknown conversation item type: ${(item as { type: string }).type}`);
    });
}

// =============================================================================
// Decoding: OpenAI → AG
// =============================================================================

// `toOpenAiSchema` rewrites optional properties as required + nullable to satisfy
// OpenAI strict mode, so the model returns `null` for unset optionals. AG-side
// validation treats those fields as optional (not nullable), so strip `null`s
// from tool-call argument payloads on the way back. Only object PROPERTIES are
// stripped: a null array item is either a genuinely nullable value that must
// survive (e.g. a rank filter's `[10, null]` bounds) or invalid input that
// AG-side validation should report rather than have silently deleted.
function stripNulls(value: unknown): unknown {
    if (Array.isArray(value)) return value.map((v) => stripNulls(v));
    if (value !== null && typeof value === 'object') {
        const out: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(value)) {
            if (v === null) continue;
            out[k] = stripNulls(v);
        }
        return out;
    }
    return value;
}

function stripNullsFromToolArgs(argsJson: string): string {
    if (!argsJson) return argsJson;
    let parsed: unknown;
    try {
        parsed = JSON.parse(argsJson);
    } catch {
        return argsJson;
    }
    return JSON.stringify(stripNulls(parsed));
}

function decodeAnnotations(annotations: any[]): any[] {
    return (annotations ?? []).map((ann: any) => {
        if (ann.type === 'file_path') {
            return { type: 'file_path', fileId: ann.file_id, index: ann.index };
        }
        if (ann.type === 'file_citation') {
            return { type: 'file_citation', fileId: ann.file_id, index: ann.index, filename: ann.filename };
        }
        if (ann.type === 'url_citation') {
            return {
                type: 'url_citation',
                url: ann.url,
                startIndex: ann.start_index,
                endIndex: ann.end_index,
                title: ann.title,
            };
        }
        if (ann.type === 'container_file_citation') {
            return {
                type: 'container_file_citation',
                containerId: ann.container_id,
                fileId: ann.file_id,
                startIndex: ann.start_index,
                endIndex: ann.end_index,
                filename: ann.filename,
            };
        }
        return ann;
    });
}

function decodeOutputContent(input: Record<string, any>): AgAiOutputContent {
    if (input.type === 'output_text') {
        return {
            type: 'text',
            text: input.text,
            annotations: decodeAnnotations(input.annotations),
        };
    }
    return input as AgAiOutputContent;
}

function decodeOutputItem(input: Record<string, any>): AgAiOutputItem {
    switch (input.type) {
        case 'message': {
            const message: AgAiOutputMessage = {
                id: input.id ?? '',
                kind: 'output',
                type: 'message',
                role: 'assistant',
                status: input.status ?? 'completed',
                content: input.content.map(decodeOutputContent),
            };
            return message;
        }
        case 'function_call':
            return {
                id: input.id ?? '',
                kind: 'output',
                type: 'function_call',
                callId: input.call_id,
                name: input.name,
                arguments: stripNullsFromToolArgs(input.arguments ?? ''),
                status: input.status,
            };
        case 'reasoning': {
            const reasoning: AgAiReasoningItem = {
                id: input.id ?? '',
                kind: 'output',
                type: 'reasoning',
                summary: input.summary.map((s: any) => ({ type: 'summary', text: s.text })),
                content: input.content?.map((c: any) => ({ type: 'text', text: c.text })),
            };
            return reasoning;
        }
        default:
            throw new Error(`Unknown output item type: ${input.type}`);
    }
}

function decodeResponse(input: Record<string, any>): AgLlmResponse {
    return {
        id: input.id,
        createdAt: input.created_at,
        model: input.model,
        incompleteDetails: input.incomplete_details ? { reason: input.incomplete_details.reason } : undefined,
        output: input.output.map(decodeOutputItem),
        status: input.status,
        error: input.error ? { code: input.error.code, message: input.error.message } : undefined,
        usage: input.usage
            ? {
                  inputTokens: input.usage.input_tokens,
                  outputTokens: input.usage.output_tokens,
                  totalTokens: input.usage.total_tokens,
                  reasoningTokens: input.usage.output_tokens_details?.reasoning_tokens,
                  cachedInputTokens: input.usage.input_tokens_details?.cached_tokens,
                  cacheWriteTokens: input.usage.input_tokens_details?.cache_write_tokens,
              }
            : undefined,
    };
}

/** What a turn produced besides its events: the final response, or the failure that ended it. */
interface TurnOutcome {
    response?: AgLlmResponse;
    error?: Error;
}

/**
 * Translates the OpenAI Responses stream into the events AG Studio reads.
 *
 * The provider is item-and-index shaped; AG Studio is message-shaped, keyed by id. The only state
 * needed to bridge them is the item id of each open item, since argument deltas arrive against the
 * item while tool events are keyed by the call.
 */
class ResponseStreamTranslator {
    private readonly callIdByItemId = new Map<string, string>();
    private readonly kindByItemId = new Map<string, 'message' | 'reasoning' | 'function_call'>();

    /** The events one SSE payload maps to. Anything not recognised is ignored, not an error. */
    translate(input: Record<string, any>, outcome: TurnOutcome): AgAiEvent[] {
        switch (input.type) {
            case 'response.output_item.added':
                return this.open(input.item);
            case 'response.output_item.done':
                return this.close(input.item);
            case 'response.output_text.delta':
            case 'response.refusal.delta':
                return [{ type: 'TEXT_MESSAGE_CONTENT', messageId: input.item_id, delta: input.delta }];
            case 'response.reasoning_text.delta':
            case 'response.reasoning_summary_text.delta':
                return [{ type: 'REASONING_MESSAGE_CONTENT', messageId: input.item_id, delta: input.delta }];
            case 'response.function_call_arguments.delta': {
                const toolCallId = this.callIdByItemId.get(input.item_id);
                return toolCallId ? [{ type: 'TOOL_CALL_ARGS', toolCallId, delta: input.delta }] : [];
            }
            case 'response.completed':
                outcome.response = decodeResponse(input.response);
                return [];
            case 'response.failed':
            case 'response.incomplete':
                outcome.error ??= new Error(input.response?.error?.message ?? `Response ${input.type}.`);
                return [];
            case 'error':
                outcome.error ??= new Error(`${input.code ?? 'api_error'}: ${input.message}`);
                return [];
            default:
                return [];
        }
    }

    private open(item: Record<string, any>): AgAiEvent[] {
        switch (item?.type) {
            case 'message':
                this.kindByItemId.set(item.id, 'message');
                return [{ type: 'TEXT_MESSAGE_START', messageId: item.id, role: 'assistant' }];
            case 'reasoning':
                this.kindByItemId.set(item.id, 'reasoning');
                return [{ type: 'REASONING_MESSAGE_START', messageId: item.id, role: 'reasoning' }];
            case 'function_call':
                this.kindByItemId.set(item.id, 'function_call');
                this.callIdByItemId.set(item.id, item.call_id);
                return [{ type: 'TOOL_CALL_START', toolCallId: item.call_id, toolCallName: item.name }];
            default:
                return [];
        }
    }

    private close(item: Record<string, any>): AgAiEvent[] {
        switch (this.kindByItemId.get(item?.id)) {
            case 'message':
                return [{ type: 'TEXT_MESSAGE_END', messageId: item.id }];
            case 'reasoning':
                return [{ type: 'REASONING_MESSAGE_END', messageId: item.id }];
            case 'function_call': {
                const toolCallId = this.callIdByItemId.get(item.id);
                return toolCallId ? [{ type: 'TOOL_CALL_END', toolCallId }] : [];
            }
            default:
                return [];
        }
    }
}

// =============================================================================
// Stream Processor
// =============================================================================

async function* streamOpenAi(
    config: OpenAiConfig,
    requestBody: Record<string, unknown>,
    outcome: TurnOutcome,
    signal?: AbortSignal
): AsyncIterableIterator<AgAiEvent> {
    const translator = new ResponseStreamTranslator();
    const emit = (payload: string): AgAiEvent[] => {
        if (payload === '[DONE]') {
            return [];
        }
        try {
            const parsed = JSON.parse(payload);
            return parsed.type === 'keepalive' ? [] : translator.translate(parsed, outcome);
        } catch (error) {
            outcome.error ??= error instanceof Error ? error : new Error(String(error));
            return [];
        }
    };

    const response = await fetch(`${config.endpoint}/responses`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            ...(config.key && { Authorization: `Bearer ${config.key}` }),
            ...(config.organization && { 'OpenAI-Organization': config.organization }),
        },
        body: JSON.stringify(requestBody),
        signal,
    });

    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error?.message || `HTTP ${response.status}: ${response.statusText}`);
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
            for (const line of frame.split('\n')) {
                if (line.startsWith('data: ')) {
                    yield* emit(line.slice(6));
                }
            }
        }
    }
}

// =============================================================================
// Request Builder
// =============================================================================

function prepareToolChoice(
    toolChoice: AgLlmRequest['toolChoice']
): 'auto' | 'none' | 'required' | { type: 'function'; name: string } | undefined {
    if (!toolChoice) return undefined;
    if (typeof toolChoice === 'string') return toolChoice;
    return { type: 'function', name: toolChoice.name };
}

function prepareResponseFormat(format: AgLlmTextFormat | AgLlmJsonFormat): Record<string, unknown> {
    if (format.type === 'text') return { type: 'text' };
    return {
        type: 'json_schema',
        name: format.name,
        description: format.description,
        schema: toOpenAiSchema(format.schema as JsonSchema),
        strict: true,
    };
}

function runRequest(config: OpenAiConfig, request: AgLlmRequest, signal?: AbortSignal): AgLlmResponseHandler {
    const { tools = [], toolChoice, responseFormat, input, model, ...rest } = request;

    const requestBody: Record<string, unknown> = {
        ...rest,
        input: encodeConversationItems(input),
        // `request.model` carries whichever model the reader picked, and is absent when the chat
        // offers no choice - so the adapter's own model is the fallback, not an override.
        model: model?.id ?? config.model,
        stream: true,
        tools: tools.map((tool: AgAiToolSchema) => ({
            type: 'function' as const,
            name: tool.name,
            description: tool.description,
            parameters: toOpenAiSchema(tool.parameters as unknown as JsonSchema),
            strict: true,
        })),
        tool_choice: prepareToolChoice(toolChoice),
        text: { format: prepareResponseFormat(responseFormat!) },
        // Studio's effort ids are passed straight through as OpenAI's reasoning effort. A model
        // declared without efforts sends none, so the adapter's own default applies.
        reasoning: { effort: model?.effort ?? 'medium' },
        parallel_tool_calls: true,
    };

    const outcome: TurnOutcome = {};
    const streamIterator = streamOpenAi(config, requestBody, outcome, signal);

    let resolveComplete: (response: AgLlmResponse) => void;
    let rejectComplete: (error: Error) => void;

    const completePromise = new Promise<AgLlmResponse>((resolve, reject) => {
        resolveComplete = resolve;
        rejectComplete = reject;
    });

    // `complete` rejects on a failed turn: the host ends a run on a throw from here and reads
    // nothing off the response's own status.
    // A failed turn is reported once, through `complete`. Rethrowing as well would leave the
    // rejection unobserved whenever a consumer stops reading the stream before awaiting it - which
    // is exactly what happens on an HTTP error or a cancellation - and that surfaces as an unhandled
    // rejection rather than as the run's own error.
    async function* wrappedIterator(): AsyncIterableIterator<AgAiEvent> {
        try {
            yield* streamIterator;
        } catch (error) {
            outcome.error ??= error instanceof Error ? error : new Error(String(error));
        }
        if (outcome.error) {
            rejectComplete(outcome.error);
        } else if (outcome.response) {
            resolveComplete(outcome.response);
        } else {
            rejectComplete(new Error('Stream completed without a final response.'));
        }
    }

    // Marks the rejection observed for a consumer that abandons the stream and never awaits
    // `complete`; anyone who does await it still sees the failure.
    void completePromise.catch(() => {});

    const wrapped = wrappedIterator();

    return {
        stream: { [Symbol.asyncIterator]: () => wrapped },
        complete: completePromise,
    };
}

// =============================================================================
// Factory Function
// =============================================================================

export function openaiAdapter(options: OpenAiAdapterOptions): AgLlmAdapter {
    const config: OpenAiConfig = {
        endpoint: options.endpoint ?? 'https://api.openai.com/v1',
        key: options.key,
        model: options.model ?? 'gpt-5.4-mini',
        organization: options.organization,
    };

    return {
        executeTurn: (request: AgLlmRequest, options?: { signal?: AbortSignal }) =>
            runRequest(config, request, options?.signal),
    };
}

```
