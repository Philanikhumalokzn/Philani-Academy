// Global type declaration for window.iink
export {};
declare global {
  interface Window {
    iink?: {
      Editor?: {
        load?: (...args: any[]) => any;
      };
    };
  }
}
