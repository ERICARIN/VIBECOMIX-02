/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Layer {
  id: number;
  src: string;
  name: string;
  parallax: number; // intensity/offset multiplier, e.g., 0 to 100
  hidden: boolean;
  locked?: boolean;
  tx: number; // translation X (pixels)
  ty: number; // translation Y (pixels)
  scale: number; // zoom scale multiplier
  rotate: number; // rotation in degrees
  scaleX?: number;
  scaleY?: number;
  resizeMode?: 'proportional' | 'free';
  folder?: string; // name of folder group in layer panel index
}

export interface Modifier {
  id: string;
  type: 'parallax' | 'noise' | 'tint' | 'shadow' | 'stroke-noise';
  name: string;
  enabled: boolean;
  folder?: string; // folder grouping in panels
  params: {
    intensity?: number;
    speed?: number;
    color?: string;
    shadowX?: number;
    shadowY?: number;
    blur?: number;
    trigger?: 'page' | 'frame';
    noiseScale?: number;
    thicknessNoise?: number;
    segmentLength?: number;
    fps?: number;
  };
  targetIds: number[];
  targetWeights?: Record<number, number>; // targetId -> weight
}

export interface Frame {
  id: number;
  parentId?: number; // ID of the parent frame in hierarchical masking (matryoshka)
  x: number; // Left coordinate on page (relative, 1 to pageW)
  y: number; // Top coordinate on page
  w: number; // Width
  h: number; // Height
  name?: string; // Optional name for page-level layer list
  tx?: number; // Translation X
  ty?: number; // Translation Y
  scale?: number; // Scale multiplier
  scaleX?: number;
  scaleY?: number;
  rotate?: number; // Rotation angle (degrees)
  hidden?: boolean;
  locked?: boolean;
  folder?: string; // folder grouping in page-level index
  modifiers?: Modifier[];
  vertices?: {
    x: number;
    y: number;
    handleIn?: { x: number; y: number };
    handleOut?: { x: number; y: number };
    isCurve?: boolean;
  }[]; // Coordinates of vertices relative to the page
  isClosed?: boolean; // If false, renders as open path (e.g. vector stroke)
  fillColor?: string; // Custom background/fill color (defaults to state.pageBg)
  strokeColor?: string; // Custom stroke outline color (defaults to state.strokeColor)
  strokeWidth?: number; // Custom stroke width (defaults to state.strokeWidth)
  strokeDasharray?: string; // Custom dash pattern (e.g. "none", "4 4", "1 4")
  strokeType?: 'solid' | 'dashed' | 'dotted' | 'dashdot' | 'rough' | 'brush' | 'calligraphy' | 'wiggly';
  passepartout?: boolean; // If false, disables viewport darken/dashed outlines in edit mode
  layers: Layer[];
  borderWidths: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  strokeWidths: {
    top?: number;
    bottom?: number;
    left?: number;
    right?: number;
  };
  vertexPressures?: number[]; // Local stroke width multipliers per vertex (default is 1.0)
}

export interface Page {
  frames: Frame[];
  w?: number; // Overridden width for this page specifically
  h?: number; // Overridden height for this page specifically
  borderWidth?: number;
  borderColor?: string;
  strokeWidth?: number;
  strokeColor?: string;
  modifiers?: Modifier[];
  folder?: string; // name of folder group for pages
  name?: string; // custom page name
}

export interface AppState {
  width: number;
  height: number;
  borderColor: string;
  borderWidth: number;
  strokeColor: string;
  strokeWidth: number;
  pageBg: string;
  pages: Page[];
  currentPage: number;
  strokeCaps?: 'round' | 'flat';
}
