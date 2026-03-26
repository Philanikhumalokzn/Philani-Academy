declare module '@capacitor/status-bar' {
  export const Style: {
    Light: string
    Dark: string
    Default: string
  }

  export const StatusBar: {
    setStyle(options: { style: string }): Promise<void>
  }
}