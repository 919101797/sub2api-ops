export interface MotionState {
  x: number
  y: number
  targetX: number
  targetY: number
  energy: number
  focus: boolean
  sceneProgress: number
  eclipse: number
}

export interface Palette {
  accent: [number, number, number]
  secondary: [number, number, number]
  tertiary: [number, number, number]
  ink: [number, number, number]
  dark: boolean
}

export type DrawScene = (
  context: CanvasRenderingContext2D,
  motion: MotionState,
  width: number,
  height: number,
  time: number,
  palette: Palette,
) => void

export function rgba(rgb: [number, number, number], alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}
