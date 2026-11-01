# 🗺️ PROJECT_CONTEXT: Comic Layout & Manga Vector Creator
*High-density architectural and code reference file for future model instances and fresh context windows.*

---

## 🚀 1. Overview & Mission
This application is a highly optimized, interactive, professional **Infinite Comic Frame & Manga Layout Creator**. It allows comic artists and storyboarders to visually design custom page layouts, slice panels with a real-time knife tool, manipulate frame boundaries as editable vector curves with Bezier anchors, adjust stroke weights locally using pressure weights, and drop image overlays inside panel boundaries with precise SVG-based clipping paths.

---

## 📂 2. Core Repository Structure

```
├── /src
│   ├── types.ts          # Core high-fidelity Type Declarations
│   ├── App.tsx           # Global State management, Undo/Redo, Panels & Exporters
│   ├── index.css         # Tailwind & custom typography style definitions
│   ├── components/
│   │   ├── Workspace.tsx # The master canvas, handles pan/zoom, drags, drawing, slicing, & SVG overlays
│   │   ├── ...           # Visual widgets (Tools panels, sliders)
│   └── utils/
│       └── geometry.ts   # Curve calculations, transformations, slice geometry, adjustments
```

---

## 📐 3. Data Model & Types (`types.ts`)
The application is strictly typed for precision. Key constructs:

*   **`Layer`**: An individual image overlay loaded into a frame. Has dimensions, translation (`tx`, `ty`), scale (`scale`), rotation, opacity, and layering stack hierarchy.
*   **`Frame`**: A comic panel.
    *   Can be a standard box or a complex customized vector polygon.
    *   **Vertices**: Array of absolute points representation relative to page grid.
    *   **Bezier Curve Attributes**: Vertices are extended with support for `handleIn?: Point`, `handleOut?: Point`, and boolean `isCurve?: boolean` to model smooth curves.
    *   **Transformations**: Supports local frame parameters `tx` (Translate X), `ty` (Translate Y), `scale`, `rotate` to shift/rotate/scale the entire vector shape without altering base vertex indices. This allows seamless drag-and-translate, zoom-scaling, and scroll-wheel tuning of complete panels!
    *   **Vertex Pressures**: Array of numeric multipliers (`0.1` to `5.0`) mapped to each vertex to render hand-drawn tapered ink lines.
*   **`Page`**: A set of frames representing a page. The workspace supports multi-page storyboarding.
*   **`AppState`**: Holds current width, height, common border margins, fallback stroke outlines, actual `pages` list, and `currentPage` pointer.

---

## 🧮 4. Key Mathematical & SVG Engines (`geometry.ts`)

### A. Coordinate Transformations
*   **`getTransformedVertices(fr: Frame)`**: Takes base vertices and applies `scale`, `rotate`, and translate translation values (`tx`, `ty`) relative to the polygon bounding box's geometric center. Also rotates the Bezier handle offsets so control paths align seamlessly.
*   **`getSvgPathFromVertices(vertices)`**: Converts a list of vertices (with or without `handleIn`/`handleOut` control points) into standard SVG Cubic Bezier path definition `M ... C ... Z` strings.
*   **`getAdjustedVertices(fr, pw, ph, stateBorderWidth, pageBorderWidth)`**: Computes final drawing coordinates while factoring in frame-specific or page-wide border gaps (to ensure gutters look clean and aligned).

### B. Clipping Masks & High-Fidelity Rendering
To avoid content clipping outside of weirdly shaped vector panels, each frame utilizes a two-part rendering system:
1.  **DOM Content Mask**: An inline local `<svg>` defining a `<clipPath id="clip-[frame-id]">` with a `<path d={clipPathD} />` generated via `getSvgPathFromVertices`. This mask clips the layers inside the HTML boundaries correctly.
2.  **Stroke Outline Layer**: To prevent stroke edges from being cropped by the container DOM clip limits, we draw the outlines inside a **page-wide overlay SVG context**.

### C. Advanced Hand-Drawn Stroke Tapering
The outline engine subdivides curves into multiple samples. It computes normal perpendicular offset vectors for each point and interpolates the pressure weights (`vertexPressures`) to generate thick-and-thin polygon segments (`<polygon points="..." />`) with rounded caps for a beautiful organic, ink-brushed look.

---

## 🎮 5. Workspace State Machine & Interaction Modes (`Workspace.tsx`)
The `Workspace` manages interactive tool modes:
*   **`select` Mode**:
    *   Single-click selects and focuses panel layer stack.
    *   Double-click enables layer transformations or inner asset dragging.
    *   Holding left click translates the entire frame coordinates (`tx`, `ty`).
    *   Scroll wheel over active frame scales the frame (`scale` scaling).
    *   Shift + Scroll wheel rotates the frame (`rotate` rotation).
*   **`knife` Mode**:
    *   Drag a slice line across a panel.
    *   Splits any frame intersected by the slice line into two custom vector polygons, distributing internal layers gracefully.
*   **`vertex` Mode**:
    *   A regular selection lasso allows selecting vertices.
    *   Dragging vertex positions adjusts panel outline.
    *   Clicking selected vertex shows **Bezier control tangent handles** (represented as dashed handles). Dragging these changes the handle vectors, dynamically warping panel curves!
*   **`pressure` Mode**:
    *   Select vertices and drag dedicated radial weight handle circles to modify custom brush outlines in real-time.

### Hotkeys Registered on Active Sheet:
*   `Ctrl + Z` & `Ctrl + Y` (or Shift + Z): Responsive Undo & Redo.
*   `Delete`, `Backspace`, or `X` (works on both English and Russian layouts):
    *   Removes active layers inside the active panel.
    *   If no layer is actively highlighted, it deletes the highlighted comic frame.

---

## 🔮 6. Future Expansion Roadmap (Tips for Next Sessions)
1.  **Symmetry Guides & Grid Snapping**: Add magnetic helpers inside the `getSnappedPoint` coordinates inside `/src/utils/geometry.ts`.
2.  **Manga Screen-tones & Fill Generators**: Expand frame layer types to support custom SVG patterns (screentones, dot half-tones, or speed lines).
3.  **Comic Text Bubble Tool**: Add a new bubble generator placing editable SVGs with text layers inside frames.

🌟 *All code compiled successfully, lints green, and has zero warnings!*
