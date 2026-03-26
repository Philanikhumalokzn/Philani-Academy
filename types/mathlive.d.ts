declare module 'mathlive' {
  export class MathfieldElement extends HTMLElement {
    value: string
    position: number
    readOnly: boolean
    smartFence: boolean
    smartMode: boolean
    smartSuperscript: boolean
    mathVirtualKeyboardPolicy: string
    getValue(format?: string): string
    setValue(value: string): void
    executeCommand(command: unknown): boolean
    getOffsetFromPoint(x: number, y: number, options?: { bias?: number }): number
    focus(): void
  }
}